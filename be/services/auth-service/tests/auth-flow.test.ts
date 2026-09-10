import { createHash, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import type { RecoveryDelivery, RecoveryDeliveryMessage } from '../src/modules/auth/recovery-delivery.js';
import type { OtpDelivery, OtpDeliveryMessage } from '../src/modules/auth/otp-delivery.js';
import type {
  AuthPrincipal,
  AuthRepository,
  CredentialUser,
  PatientRegistrationInput,
  RotateSessionResult,
  SessionMetadata,
} from '../src/modules/auth/auth.types.js';

const requestId = '74ed3a7b-d580-448a-8570-22cb2345c6be';
let passwordHash: string;

class MemoryAuthRepository implements AuthRepository {
  failed = 0;
  sessions = new Map<string, { userId: number; sessionId: string; replaced: boolean; revoked: boolean }>();
  resetTokens = new Map<string, { userId: number; active: boolean }>();
  registrations = new Map<string, PatientRegistrationInput & { active: boolean }>();
  user: CredentialUser;

  constructor() {
    this.user = {
      userId: 1,
      publicId: randomUUID(),
      displayName: 'Quản trị viên',
      passwordHash,
      email: 'admin@example.com',
      phone: null,
      status: 'ACTIVE',
      lockedUntilUtc: null,
      tokenVersion: 1,
      roles: [{ code: 'ADMIN', branchId: null }],
      permissions: ['USERS_MANAGE'],
    };
  }

  findCredential(identifier: string) {
    return Promise.resolve(identifier === 'admin' ? this.user : null);
  }
  getCredential(userId: number) {
    return Promise.resolve(userId === this.user.userId ? this.user : null);
  }
  findPasswordResetCredential(tokenHash: Buffer) {
    const token = this.resetTokens.get(tokenHash.toString('hex'));
    return Promise.resolve(token?.active
      ? { userId: token.userId, passwordHash: this.user.passwordHash }
      : null);
  }
  getPrincipal(userId: number): Promise<AuthPrincipal | null> {
    return Promise.resolve(userId === this.user.userId ? this.user : null);
  }
  recordLoginFailure() {
    this.failed += 1;
    return Promise.resolve(this.failed >= 2 ? new Date(Date.now() + 60_000) : null);
  }
  createSession(user: AuthPrincipal, hash: Buffer) {
    const sessionId = randomUUID();
    this.sessions.set(hash.toString('hex'), { userId: user.userId, sessionId, replaced: false, revoked: false });
    return Promise.resolve(sessionId);
  }
  rotateSession(current: Buffer, next: Buffer, _expiry: Date, _metadata: SessionMetadata): Promise<RotateSessionResult> {
    const currentSession = this.sessions.get(current.toString('hex'));
    if (!currentSession || currentSession.revoked) {
      return Promise.resolve({ userId: null, tokenVersion: null, sessionId: null, reuseDetected: false });
    }
    if (currentSession.replaced) {
      for (const session of this.sessions.values()) session.revoked = true;
      this.user.tokenVersion += 1;
      return Promise.resolve({ userId: this.user.userId, tokenVersion: this.user.tokenVersion, sessionId: null, reuseDetected: true });
    }
    currentSession.replaced = true;
    const sessionId = randomUUID();
    this.sessions.set(next.toString('hex'), { userId: currentSession.userId, sessionId, replaced: false, revoked: false });
    return Promise.resolve({ userId: currentSession.userId, tokenVersion: this.user.tokenVersion, sessionId, reuseDetected: false });
  }
  revokeSession(hash: Buffer) {
    const session = this.sessions.get(hash.toString('hex'));
    if (session) session.revoked = true;
    return Promise.resolve();
  }
  revokeAllSessions() {
    for (const session of this.sessions.values()) session.revoked = true;
    this.user.tokenVersion += 1;
    return Promise.resolve();
  }
  createPasswordReset(userId: number, tokenHash: Buffer) {
    for (const token of this.resetTokens.values()) token.active = false;
    this.resetTokens.set(tokenHash.toString('hex'), { userId, active: true });
    return Promise.resolve(true);
  }
  cancelPasswordReset(tokenHash: Buffer) {
    const token = this.resetTokens.get(tokenHash.toString('hex'));
    if (token) token.active = false;
    return Promise.resolve();
  }
  consumePasswordReset(tokenHash: Buffer, newPasswordHash: string) {
    const token = this.resetTokens.get(tokenHash.toString('hex'));
    if (!token?.active) return Promise.resolve(false);
    token.active = false;
    this.user.passwordHash = newPasswordHash;
    this.user.tokenVersion += 1;
    for (const session of this.sessions.values()) session.revoked = true;
    return Promise.resolve(true);
  }
  changePassword(_userId: number, expectedPasswordHash: string, newPasswordHash: string) {
    if (this.user.passwordHash !== expectedPasswordHash) return Promise.reject({ number: 53062 });
    this.user.passwordHash = newPasswordHash;
    this.user.tokenVersion += 1;
    for (const session of this.sessions.values()) session.revoked = true;
    return Promise.resolve();
  }
  getRegistrationBranchId() {
    return Promise.resolve(1);
  }
  createPatientRegistration(input: PatientRegistrationInput) {
    const existing = [...this.registrations.values()].find((item) => item.idempotencyKey === input.idempotencyKey);
    if (existing) {
      if (!existing.requestHash.equals(input.requestHash)) return Promise.reject({ number: 53073 });
      return Promise.resolve({ challengeId: existing.challengeId, created: false });
    }
    if (input.contactNormalized === this.user.email) {
      this.registrations.set(input.challengeId, { ...input, active: false });
      return Promise.resolve({ challengeId: input.challengeId, created: false });
    }
    this.registrations.set(input.challengeId, { ...input, active: true });
    return Promise.resolve({ challengeId: input.challengeId, created: true });
  }
  cancelPatientRegistration(challengeId: string) {
    const challenge = this.registrations.get(challengeId);
    if (challenge) challenge.active = false;
    return Promise.resolve();
  }
  verifyPatientRegistration(challengeId: string, otpHash: Buffer) {
    const challenge = this.registrations.get(challengeId);
    if (!challenge?.active || !challenge.otpHash.equals(otpHash)) {
      return Promise.resolve({ succeeded: false, userId: null, patientPublicId: null, patientCode: null });
    }
    challenge.active = false;
    return Promise.resolve({
      succeeded: true,
      userId: 2,
      patientPublicId: randomUUID(),
      patientCode: 'BN-20260910-000001',
    });
  }
}

class MemoryRecoveryDelivery implements RecoveryDelivery {
  messages: RecoveryDeliveryMessage[] = [];
  fail = false;
  deliver(message: RecoveryDeliveryMessage) {
    if (this.fail) return Promise.reject(new Error('delivery unavailable'));
    this.messages.push(message);
    return Promise.resolve();
  }
}

class MemoryOtpDelivery implements OtpDelivery {
  messages: OtpDeliveryMessage[] = [];
  fail = false;
  deliver(message: OtpDeliveryMessage) {
    if (this.fail) return Promise.reject(new Error('otp delivery unavailable'));
    this.messages.push(message);
    return Promise.resolve();
  }
}

function app(repository: MemoryAuthRepository, delivery?: RecoveryDelivery, otpDelivery?: OtpDelivery) {
  return createApp({
    authService: new AuthService(repository, undefined, delivery, otpDelivery),
    databaseProbe: async () => ({ database: 'test' }),
  });
}

beforeAll(async () => {
  passwordHash = await argon2.hash('CorrectPassword123!', { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2 });
});

describe('authentication vertical slice', () => {
  let repository: MemoryAuthRepository;
  beforeEach(() => { repository = new MemoryAuthRepository(); });

  it('logs in a web admin and keeps the refresh token in an HttpOnly cookie', async () => {
    const response = await request(app(repository)).post('/api/v1/auth/login').set('x-request-id', requestId).send({
      identifier: 'admin', password: 'CorrectPassword123!', clientType: 'web',
    });
    expect(response.status).toBe(200);
    expect(response.body.data.user.roles[0].code).toBe('ADMIN');
    expect(response.body.data.accessToken).toBeTypeOf('string');
    expect(response.body.data.refreshToken).toBeUndefined();
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(response.body.requestId).toBe(requestId);
  });

  it('does not reveal whether an identifier exists', async () => {
    const known = await request(app(repository)).post('/api/v1/auth/login').send({
      identifier: 'admin', password: 'WrongPassword123!', clientType: 'web',
    });
    const unknown = await request(app(repository)).post('/api/v1/auth/login').send({
      identifier: 'missing-user', password: 'WrongPassword123!', clientType: 'web',
    });
    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toEqual(known.body.error);
  });

  it('locks the account at the configured failed-attempt boundary', async () => {
    const first = await request(app(repository)).post('/api/v1/auth/login').send({
      identifier: 'admin', password: 'WrongPassword123!', clientType: 'web',
    });
    const second = await request(app(repository)).post('/api/v1/auth/login').send({
      identifier: 'admin', password: 'WrongPassword123!', clientType: 'web',
    });
    expect(first.status).toBe(401);
    expect(second.status).toBe(423);
    expect(second.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('rotates a mobile refresh token and detects replay of the old token', async () => {
    const login = await request(app(repository)).post('/api/v1/auth/login').send({
      identifier: 'admin', password: 'CorrectPassword123!', clientType: 'mobile',
    });
    const oldRefreshToken = login.body.data.refreshToken as string;
    expect(createHash('sha256').update(oldRefreshToken).digest().length).toBe(32);

    const refreshed = await request(app(repository)).post('/api/v1/auth/refresh').send({ refreshToken: oldRefreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.refreshToken).not.toBe(oldRefreshToken);

    const replay = await request(app(repository)).post('/api/v1/auth/refresh').send({ refreshToken: oldRefreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSE_DETECTED');
  });

  it('rotates and revokes a web session through its HttpOnly cookie', async () => {
    const browser = request.agent(app(repository));
    const login = await browser.post('/api/v1/auth/login').send({
      identifier: 'admin', password: 'CorrectPassword123!', clientType: 'web',
    });
    const refreshed = await browser.post('/api/v1/auth/refresh').send({});
    const logout = await browser.post('/api/v1/auth/logout').send({});
    expect(login.status).toBe(200);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.refreshToken).toBeUndefined();
    expect(logout.status).toBe(200);
    expect(logout.body.data.loggedOut).toBe(true);
    expect([...repository.sessions.values()].filter((session) => !session.replaced).every((session) => session.revoked)).toBe(true);
  });

  it('logs out all devices and revokes the access token version', async () => {
    const login = await request(app(repository)).post('/api/v1/auth/login').send({
      identifier: 'admin', password: 'CorrectPassword123!', clientType: 'mobile',
    });
    const response = await request(app(repository)).post('/api/v1/auth/logout-all')
      .set('authorization', `Bearer ${login.body.data.accessToken as string}`).send({});
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ loggedOut: true, allDevices: true });
    const rejected = await request(app(repository)).post('/api/v1/auth/logout-all')
      .set('authorization', `Bearer ${login.body.data.accessToken as string}`).send({});
    expect(rejected.status).toBe(401);
    expect(rejected.body.error.code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('returns the same accepted response for known and unknown recovery identifiers', async () => {
    const delivery = new MemoryRecoveryDelivery();
    const server = app(repository, delivery);
    const known = await request(server).post('/api/v1/auth/password/forgot').send({ identifier: 'admin' });
    const unknown = await request(server).post('/api/v1/auth/password/forgot').send({ identifier: 'missing-user' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.headers['cache-control']).toBe('no-store');
    expect(known.body.data).toEqual(unknown.body.data);
    expect(delivery.messages).toHaveLength(1);
    expect(delivery.messages[0]?.recipient).toBe('admin@example.com');
  });

  it('resets a password with a one-time opaque link and rejects replay', async () => {
    const delivery = new MemoryRecoveryDelivery();
    const server = app(repository, delivery);
    await request(server).post('/api/v1/auth/password/forgot').send({ identifier: 'admin' });
    const resetUrl = new URL(delivery.messages[0]!.resetUrl);
    const token = new URLSearchParams(resetUrl.hash.slice(1)).get('token');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const reusedPassword = await request(server).post('/api/v1/auth/password/reset').send({
      token, newPassword: 'CorrectPassword123!',
    });
    const reset = await request(server).post('/api/v1/auth/password/reset').send({
      token, newPassword: 'ResetPassword456!',
    });
    const replay = await request(server).post('/api/v1/auth/password/reset').send({
      token, newPassword: 'AnotherPassword789!',
    });
    const login = await request(server).post('/api/v1/auth/login').send({
      identifier: 'admin', password: 'ResetPassword456!', clientType: 'mobile',
    });
    expect(reusedPassword.status).toBe(409);
    expect(reusedPassword.body.error.code).toBe('PASSWORD_REUSE_NOT_ALLOWED');
    expect(reset.status).toBe(200);
    expect(reset.body.data).toEqual({ passwordChanged: true, allSessionsRevoked: true });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('INVALID_OR_EXPIRED_RESET_TOKEN');
    expect(login.status).toBe(200);
  });

  it('changes an authenticated password and invalidates every existing token', async () => {
    const server = app(repository);
    const login = await request(server).post('/api/v1/auth/login').send({
      identifier: 'admin', password: 'CorrectPassword123!', clientType: 'mobile',
    });
    const accessToken = login.body.data.accessToken as string;
    const changed = await request(server).post('/api/v1/auth/password/change')
      .set('authorization', `Bearer ${accessToken}`).send({
        currentPassword: 'CorrectPassword123!', newPassword: 'ChangedPassword456!',
      });
    const oldToken = await request(server).post('/api/v1/auth/logout-all')
      .set('authorization', `Bearer ${accessToken}`).send({});
    const newLogin = await request(server).post('/api/v1/auth/login').send({
      identifier: 'admin', password: 'ChangedPassword456!', clientType: 'mobile',
    });
    expect(changed.status).toBe(200);
    expect(oldToken.status).toBe(401);
    expect(newLogin.status).toBe(200);
  });

  it('rejects an incorrect current password and reuse of the current password', async () => {
    const server = app(repository);
    const login = await request(server).post('/api/v1/auth/login').send({
      identifier: 'admin', password: 'CorrectPassword123!', clientType: 'mobile',
    });
    const authorization = `Bearer ${login.body.data.accessToken as string}`;
    const incorrect = await request(server).post('/api/v1/auth/password/change')
      .set('authorization', authorization).send({
        currentPassword: 'WrongPassword123!', newPassword: 'ChangedPassword456!',
      });
    const reused = await request(server).post('/api/v1/auth/password/change')
      .set('authorization', authorization).send({
        currentPassword: 'CorrectPassword123!', newPassword: 'CorrectPassword123!',
      });
    expect(incorrect.status).toBe(400);
    expect(incorrect.body.error.code).toBe('CURRENT_PASSWORD_INVALID');
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('PASSWORD_REUSE_NOT_ALLOWED');
  });

  it('cancels a reset challenge when the delivery adapter fails without exposing it', async () => {
    const delivery = new MemoryRecoveryDelivery();
    delivery.fail = true;
    const response = await request(app(repository, delivery)).post('/api/v1/auth/password/forgot')
      .send({ identifier: 'admin' });
    expect(response.status).toBe(202);
    expect([...repository.resetTokens.values()].every((token) => !token.active)).toBe(true);
  });

  it('requests an OTP without revealing whether the contact already has an account', async () => {
    const otpDelivery = new MemoryOtpDelivery();
    const server = app(repository, undefined, otpDelivery);
    const registration = {
      contactChannel: 'EMAIL', password: 'PatientPassword123', fullName: 'Nguyễn An',
      dateOfBirth: '1995-06-15', gender: 'FEMALE',
    };
    const idempotencyKey = randomUUID();
    const available = await request(server).post('/api/v1/auth/patient-registration/request')
      .set('idempotency-key', randomUUID()).send({ ...registration, contact: 'new-patient@example.com' });
    const existing = await request(server).post('/api/v1/auth/patient-registration/request')
      .set('idempotency-key', idempotencyKey).send({ ...registration, contact: 'admin@example.com' });
    const existingRetry = await request(server).post('/api/v1/auth/patient-registration/request')
      .set('idempotency-key', idempotencyKey).send({ ...registration, contact: 'admin@example.com' });
    expect(available.status).toBe(202);
    expect(existing.status).toBe(202);
    expect(available.body.data).toMatchObject({ expiresIn: 600, resendAfter: 60 });
    expect(existing.body.data).toMatchObject({ expiresIn: 600, resendAfter: 60 });
    expect(existingRetry.body.data.challengeId).toBe(existing.body.data.challengeId);
    expect(available.body.data.challengeId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(existing.body.data.challengeId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(available.headers['cache-control']).toBe('no-store');
    expect(otpDelivery.messages).toHaveLength(1);
  });

  it('completes registration once with the delivered OTP and rejects replay', async () => {
    const otpDelivery = new MemoryOtpDelivery();
    const server = app(repository, undefined, otpDelivery);
    const requested = await request(server).post('/api/v1/auth/patient-registration/request')
      .set('idempotency-key', randomUUID()).send({
        contactChannel: 'SMS', contact: '+84901234567', password: 'PatientPassword123',
        fullName: 'Trần Bình', dateOfBirth: '1988-03-20', gender: 'MALE',
      });
    const challengeId = requested.body.data.challengeId as string;
    const otp = otpDelivery.messages[0]!.otp;
    const wrongOtp = otp === '000000' ? '000001' : '000000';
    const wrong = await request(server).post('/api/v1/auth/patient-registration/verify')
      .send({ challengeId, otp: wrongOtp });
    const verified = await request(server).post('/api/v1/auth/patient-registration/verify')
      .send({ challengeId, otp });
    const replay = await request(server).post('/api/v1/auth/patient-registration/verify')
      .send({ challengeId, otp });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_OR_EXPIRED_OTP');
    expect(verified.status).toBe(201);
    expect(verified.body.data.registered).toBe(true);
    expect(verified.body.data.patient.code).toMatch(/^BN-/);
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe('INVALID_OR_EXPIRED_OTP');
  });

  it('makes patient registration idempotent and rejects reuse with another payload', async () => {
    const otpDelivery = new MemoryOtpDelivery();
    const server = app(repository, undefined, otpDelivery);
    const idempotencyKey = randomUUID();
    const registration = {
      contactChannel: 'EMAIL', contact: 'idempotent@example.com', password: 'PatientPassword123',
      fullName: 'Lê Chi', dateOfBirth: '2000-01-02', gender: 'OTHER',
    };
    const first = await request(server).post('/api/v1/auth/patient-registration/request')
      .set('idempotency-key', idempotencyKey).send(registration);
    const retry = await request(server).post('/api/v1/auth/patient-registration/request')
      .set('idempotency-key', idempotencyKey).send(registration);
    const conflict = await request(server).post('/api/v1/auth/patient-registration/request')
      .set('idempotency-key', idempotencyKey).send({ ...registration, fullName: 'Tên khác' });
    expect(first.status).toBe(202);
    expect(retry.status).toBe(202);
    expect(retry.body.data.challengeId).toBe(first.body.data.challengeId);
    expect(otpDelivery.messages).toHaveLength(1);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('invalidates the OTP challenge when delivery fails and requires a UUID idempotency key', async () => {
    const otpDelivery = new MemoryOtpDelivery();
    otpDelivery.fail = true;
    const server = app(repository, undefined, otpDelivery);
    const body = {
      contactChannel: 'EMAIL', contact: 'delivery-fail@example.com', password: 'PatientPassword123',
      fullName: 'Phạm Dung', dateOfBirth: '1999-09-09', gender: 'FEMALE',
    };
    const missingKey = await request(server).post('/api/v1/auth/patient-registration/request').send(body);
    const accepted = await request(server).post('/api/v1/auth/patient-registration/request')
      .set('idempotency-key', randomUUID()).send(body);
    const challenge = repository.registrations.get(accepted.body.data.challengeId as string);
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(accepted.status).toBe(202);
    expect(challenge?.active).toBe(false);
  });

  it('rejects browser origins outside the configured allow-list', async () => {
    const response = await request(app(repository)).post('/api/v1/auth/login')
      .set('origin', 'https://attacker.example').send({
        identifier: 'admin', password: 'CorrectPassword123!', clientType: 'web',
      });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(repository.sessions.size).toBe(0);
  });
});
