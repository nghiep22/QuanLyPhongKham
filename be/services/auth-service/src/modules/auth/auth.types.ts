export type RoleAssignment = {
  code: string;
  branchId: string | null;
};

export type AuthPrincipal = {
  userId: number;
  publicId: string;
  displayName: string;
  tokenVersion: number;
  roles: RoleAssignment[];
  permissions: string[];
};

export type CredentialUser = AuthPrincipal & {
  passwordHash: string;
  status: 'ACTIVE' | 'LOCKED' | 'DISABLED' | 'PENDING';
  lockedUntilUtc: Date | null;
};

export type SessionMetadata = {
  deviceInfo?: string;
  ipAddress?: string;
};

export type LoginInput = SessionMetadata & {
  identifier: string;
  password: string;
  clientType: 'web' | 'mobile';
};

export type AuthTokens = {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  principal: AuthPrincipal;
};

export type RotateSessionResult = {
  userId: number | null;
  tokenVersion: number | null;
  sessionId: string | null;
  reuseDetected: boolean;
};

export interface AuthRepository {
  findCredential(identifier: string): Promise<CredentialUser | null>;
  getPrincipal(userId: number): Promise<AuthPrincipal | null>;
  recordLoginFailure(userId: number, requestId: string): Promise<Date | null>;
  createSession(user: AuthPrincipal, refreshTokenHash: Buffer, expiresAtUtc: Date, metadata: SessionMetadata, requestId: string): Promise<string>;
  rotateSession(currentHash: Buffer, nextHash: Buffer, expiresAtUtc: Date, metadata: SessionMetadata, requestId: string): Promise<RotateSessionResult>;
  revokeSession(refreshTokenHash: Buffer, requestId: string): Promise<void>;
  revokeAllSessions(userId: number, requestId: string): Promise<void>;
}
