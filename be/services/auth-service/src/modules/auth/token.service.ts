import { createHash, createHmac, generateKeyPairSync, randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { exportJWK, importPKCS8, importSPKI, jwtVerify, SignJWT, type JWK, type JWTPayload } from 'jose';
import { env } from '../../config.js';
import type { AuthPrincipal } from './auth.types.js';

const algorithm = 'RS256';

export type VerifiedAccessToken = JWTPayload & {
  sub: string;
  sid: string;
  ver: number;
  uid: number;
};

function generatePemPair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

let testPemPair: ReturnType<typeof generatePemPair> | undefined;

function loadPemPair() {
  if (env.NODE_ENV === 'test') {
    testPemPair ??= generatePemPair();
    return testPemPair;
  }
  if (existsSync(env.JWT_PRIVATE_KEY_PATH) && existsSync(env.JWT_PUBLIC_KEY_PATH)) {
    return {
      privatePem: readFileSync(env.JWT_PRIVATE_KEY_PATH, 'utf8'),
      publicPem: readFileSync(env.JWT_PUBLIC_KEY_PATH, 'utf8'),
    };
  }
  if (env.NODE_ENV === 'production') throw new Error('JWT RSA key pair is required in production.');

  const pair = generatePemPair();
  mkdirSync(dirname(env.JWT_PRIVATE_KEY_PATH), { recursive: true });
  mkdirSync(dirname(env.JWT_PUBLIC_KEY_PATH), { recursive: true });
  writeFileSync(env.JWT_PRIVATE_KEY_PATH, pair.privatePem, { mode: 0o600 });
  writeFileSync(env.JWT_PUBLIC_KEY_PATH, pair.publicPem, { mode: 0o644 });
  return pair;
}

export class TokenService {
  private readonly keyId: string;
  private readonly privateKeyPromise;
  private readonly publicKeyPromise;

  constructor() {
    const { privatePem, publicPem } = loadPemPair();
    this.keyId = createHash('sha256').update(publicPem).digest('hex').slice(0, 16);
    this.privateKeyPromise = importPKCS8(privatePem, algorithm);
    this.publicKeyPromise = importSPKI(publicPem, algorithm);
  }

  createRefreshToken() {
    return randomBytes(32).toString('base64url');
  }

  createPasswordResetToken() {
    return randomBytes(32).toString('base64url');
  }

  hashRefreshToken(token: string) {
    return createHash('sha256').update(token, 'utf8').digest();
  }

  hashPasswordResetToken(token: string) {
    return createHash('sha256').update(token, 'utf8').digest();
  }

  createRegistrationOtp() {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  hashRegistrationOtp(challengeId: string, otp: string) {
    return createHmac('sha256', env.AUTH_OTP_HASH_SECRET)
      .update(`patient-registration:otp:${challengeId}:${otp}`, 'utf8')
      .digest();
  }

  hashRegistrationRequest(canonicalPayload: string) {
    return createHmac('sha256', env.AUTH_OTP_HASH_SECRET)
      .update(`patient-registration:request:${canonicalPayload}`, 'utf8')
      .digest();
  }

  hashPatientLinkRequest(canonicalPayload: string) {
    return createHmac('sha256', env.AUTH_OTP_HASH_SECRET)
      .update(`patient-link:request:${canonicalPayload}`, 'utf8')
      .digest();
  }

  refreshExpiry() {
    return new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  }

  async signAccessToken(principal: AuthPrincipal, sessionId: string) {
    return new SignJWT({
      uid: principal.userId,
      sid: sessionId,
      ver: principal.tokenVersion,
      name: principal.displayName,
      roles: principal.roles,
      permissions: principal.permissions,
    })
      .setProtectedHeader({ alg: algorithm, kid: this.keyId, typ: 'JWT' })
      .setIssuer(env.JWT_ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setSubject(principal.publicId)
      .setIssuedAt()
      .setExpirationTime(`${env.JWT_ACCESS_TTL_SECONDS}s`)
      .sign(await this.privateKeyPromise);
  }

  async verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
    const result = await jwtVerify(token, await this.publicKeyPromise, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: [algorithm],
    });
    const payload = result.payload;
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string'
      || typeof payload.ver !== 'number' || typeof payload.uid !== 'number') {
      throw new Error('Access token claims are incomplete.');
    }
    return payload as VerifiedAccessToken;
  }

  async getJwks(): Promise<{ keys: JWK[] }> {
    const key = await exportJWK(await this.publicKeyPromise);
    return { keys: [{ ...key, alg: algorithm, use: 'sig', kid: this.keyId }] };
  }
}
