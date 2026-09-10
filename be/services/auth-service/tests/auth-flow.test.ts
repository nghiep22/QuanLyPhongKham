import { createHash, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import type {
  AuthPrincipal,
  AuthRepository,
  CredentialUser,
  RotateSessionResult,
  SessionMetadata,
} from '../src/modules/auth/auth.types.js';

const requestId = '74ed3a7b-d580-448a-8570-22cb2345c6be';
let passwordHash: string;

class MemoryAuthRepository implements AuthRepository {
  failed = 0;
  sessions = new Map<string, { userId: number; sessionId: string; replaced: boolean; revoked: boolean }>();
  user: CredentialUser;

  constructor() {
    this.user = {
      userId: 1,
      publicId: randomUUID(),
      displayName: 'Quản trị viên',
      passwordHash,
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
}

function app(repository: MemoryAuthRepository) {
  return createApp({
    authService: new AuthService(repository),
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
