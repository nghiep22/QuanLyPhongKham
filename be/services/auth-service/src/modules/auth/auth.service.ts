import argon2 from 'argon2';
import { env } from '../../config.js';
import { HttpError } from '../../shared/http/errors.js';
import type { AuthRepository, AuthTokens, LoginInput, SessionMetadata } from './auth.types.js';
import { TokenService } from './token.service.js';

const dummyPasswordHash = '$argon2id$v=19$m=19456,t=2,p=1$62vxZxG32M0TiTcGJbAxQg$QbuWRO9aarx2WUiY//mMZXGSonHQ3B+JgO73qybSIlo';
const refreshTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly tokens = new TokenService(),
  ) {}

  private async issueTokens(userId: number, sessionId: string, refreshToken: string): Promise<AuthTokens> {
    const principal = await this.repository.getPrincipal(userId);
    if (!principal) throw new HttpError(401, 'ACCOUNT_UNAVAILABLE', 'Tài khoản không còn khả dụng.');
    return {
      accessToken: await this.tokens.signAccessToken(principal, sessionId),
      expiresIn: env.JWT_ACCESS_TTL_SECONDS,
      refreshToken,
      principal,
    };
  }

  async login(input: LoginInput, requestId: string): Promise<AuthTokens> {
    const credential = await this.repository.findCredential(input.identifier);
    const passwordMatches = await argon2.verify(credential?.passwordHash ?? dummyPasswordHash, input.password);

    if (!credential) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Thông tin đăng nhập không hợp lệ.');
    if (credential.status !== 'ACTIVE') {
      throw new HttpError(403, 'ACCOUNT_UNAVAILABLE', 'Tài khoản không ở trạng thái hoạt động.');
    }
    if (credential.lockedUntilUtc && credential.lockedUntilUtc.getTime() > Date.now()) {
      throw new HttpError(423, 'ACCOUNT_LOCKED', 'Tài khoản đang tạm khóa.', {
        lockedUntilUtc: credential.lockedUntilUtc.toISOString(),
      });
    }
    if (!passwordMatches) {
      const lockedUntilUtc = await this.repository.recordLoginFailure(credential.userId, requestId);
      if (lockedUntilUtc) {
        throw new HttpError(423, 'ACCOUNT_LOCKED', 'Tài khoản đã bị tạm khóa do đăng nhập sai nhiều lần.', {
          lockedUntilUtc: lockedUntilUtc.toISOString(),
        });
      }
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Thông tin đăng nhập không hợp lệ.');
    }

    const refreshToken = this.tokens.createRefreshToken();
    const sessionId = await this.repository.createSession(
      credential,
      this.tokens.hashRefreshToken(refreshToken),
      this.tokens.refreshExpiry(),
      input,
      requestId,
    );
    return this.issueTokens(credential.userId, sessionId, refreshToken);
  }

  async refresh(refreshToken: string, metadata: SessionMetadata, requestId: string): Promise<AuthTokens> {
    if (!refreshTokenPattern.test(refreshToken)) {
      throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token không hợp lệ.');
    }
    const nextRefreshToken = this.tokens.createRefreshToken();
    const rotation = await this.repository.rotateSession(
      this.tokens.hashRefreshToken(refreshToken),
      this.tokens.hashRefreshToken(nextRefreshToken),
      this.tokens.refreshExpiry(),
      metadata,
      requestId,
    );
    if (rotation.reuseDetected) {
      throw new HttpError(401, 'REFRESH_TOKEN_REUSE_DETECTED', 'Phiên đăng nhập đã bị thu hồi vì phát hiện token được dùng lại.');
    }
    if (!rotation.userId || !rotation.sessionId) {
      throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token không hợp lệ hoặc đã hết hạn.');
    }
    return this.issueTokens(rotation.userId, rotation.sessionId, nextRefreshToken);
  }

  async logout(refreshToken: string | undefined, requestId: string) {
    if (refreshToken && refreshTokenPattern.test(refreshToken)) {
      await this.repository.revokeSession(this.tokens.hashRefreshToken(refreshToken), requestId);
    }
  }

  async authenticate(accessToken: string) {
    try {
      const verified = await this.tokens.verifyAccessToken(accessToken);
      const principal = await this.repository.getPrincipal(verified.uid);
      if (!principal || principal.publicId !== verified.sub || principal.tokenVersion !== verified.ver) {
        throw new Error('Token was revoked.');
      }
      return principal;
    } catch {
      throw new HttpError(401, 'INVALID_ACCESS_TOKEN', 'Access token không hợp lệ hoặc đã hết hạn.');
    }
  }

  logoutAll(userId: number, requestId: string) {
    return this.repository.revokeAllSessions(userId, requestId);
  }

  getJwks() {
    return this.tokens.getJwks();
  }
}
