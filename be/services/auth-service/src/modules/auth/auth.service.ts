import argon2 from 'argon2';
import { env } from '../../config.js';
import { HttpError } from '../../shared/http/errors.js';
import type { AuthRepository, AuthTokens, LoginInput, SessionMetadata } from './auth.types.js';
import { TokenService } from './token.service.js';
import { createRecoveryDelivery, type RecoveryDelivery } from './recovery-delivery.js';

const dummyPasswordHash = '$argon2id$v=19$m=19456,t=2,p=1$62vxZxG32M0TiTcGJbAxQg$QbuWRO9aarx2WUiY//mMZXGSonHQ3B+JgO73qybSIlo';
const refreshTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly tokens = new TokenService(),
    private readonly recoveryDelivery: RecoveryDelivery = createRecoveryDelivery(),
  ) {}

  private hashPassword(password: string) {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

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

  async changePassword(userId: number, currentPassword: string, newPassword: string, requestId: string) {
    const credential = await this.repository.getCredential(userId);
    if (!credential || credential.status !== 'ACTIVE'
      || !await argon2.verify(credential.passwordHash, currentPassword)) {
      throw new HttpError(400, 'CURRENT_PASSWORD_INVALID', 'Mật khẩu hiện tại không đúng.');
    }
    if (await argon2.verify(credential.passwordHash, newPassword)) {
      throw new HttpError(409, 'PASSWORD_REUSE_NOT_ALLOWED', 'Mật khẩu mới phải khác mật khẩu hiện tại.');
    }
    const newPasswordHash = await this.hashPassword(newPassword);
    try {
      await this.repository.changePassword(userId, credential.passwordHash, newPasswordHash, requestId);
    } catch (error) {
      const number = error && typeof error === 'object' && 'number' in error ? error.number : undefined;
      if (number === 53062) {
        throw new HttpError(409, 'PASSWORD_CHANGED_CONCURRENTLY', 'Mật khẩu đã được thay đổi ở phiên khác.');
      }
      throw error;
    }
  }

  async requestPasswordReset(identifier: string, ipAddress: string | undefined, requestId: string) {
    const startedAt = Date.now();
    const credential = await this.repository.findCredential(identifier);
    const token = this.tokens.createPasswordResetToken();
    const tokenHash = this.tokens.hashPasswordResetToken(token);
    if (!credential || !['ACTIVE', 'LOCKED'].includes(credential.status)) {
      await this.delayRecoveryResponse(startedAt);
      return;
    }
    const recipient = credential.email ?? credential.phone;
    if (!recipient) {
      await this.delayRecoveryResponse(startedAt);
      return;
    }
    const expiresAtUtc = new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000);
    const created = await this.repository.createPasswordReset(
      credential.userId, tokenHash, expiresAtUtc, ipAddress, requestId,
    );
    if (!created) {
      await this.delayRecoveryResponse(startedAt);
      return;
    }
    const url = new URL(env.PASSWORD_RESET_URL);
    url.hash = new URLSearchParams({ token }).toString();
    try {
      await this.recoveryDelivery.deliver({
        channel: credential.email ? 'EMAIL' : 'SMS',
        recipient,
        displayName: credential.displayName,
        resetUrl: url.toString(),
        expiresAtUtc: expiresAtUtc.toISOString(),
      });
    } catch {
      await this.repository.cancelPasswordReset(tokenHash, requestId).catch(() => undefined);
    }
    await this.delayRecoveryResponse(startedAt);
  }

  private async delayRecoveryResponse(startedAt: number) {
    const minimumMs = 350;
    const remaining = minimumMs - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  async resetPassword(token: string, newPassword: string, requestId: string) {
    const tokenHash = this.tokens.hashPasswordResetToken(token);
    const credential = await this.repository.findPasswordResetCredential(tokenHash);
    const matchesCurrent = await argon2.verify(credential?.passwordHash ?? dummyPasswordHash, newPassword);
    if (credential && matchesCurrent) {
      throw new HttpError(409, 'PASSWORD_REUSE_NOT_ALLOWED', 'Mật khẩu mới phải khác mật khẩu hiện tại.');
    }
    const newPasswordHash = await this.hashPassword(newPassword);
    const succeeded = await this.repository.consumePasswordReset(
      tokenHash, newPasswordHash, requestId,
    );
    if (!succeeded) {
      throw new HttpError(400, 'INVALID_OR_EXPIRED_RESET_TOKEN', 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
    }
  }

  getJwks() {
    return this.tokens.getJwks();
  }
}
