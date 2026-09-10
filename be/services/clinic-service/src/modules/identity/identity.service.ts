import { readFile } from 'node:fs/promises';
import { importSPKI, jwtVerify } from 'jose';
import { env } from '../../config.js';
import { HttpError } from '../../shared/http/errors.js';
import type { ClinicPrincipal, PrincipalAuthenticator, PrincipalRepository } from './identity.types.js';

export class JwtPrincipalAuthenticator implements PrincipalAuthenticator {
  private publicKeyPromise?: ReturnType<typeof importSPKI>;

  constructor(private readonly repository: PrincipalRepository) {}

  private publicKey() {
    this.publicKeyPromise ??= readFile(env.JWT_PUBLIC_KEY_PATH, 'utf8')
      .then((pem) => importSPKI(pem, 'RS256'));
    return this.publicKeyPromise;
  }

  async authenticate(accessToken: string): Promise<ClinicPrincipal> {
    try {
      const { payload } = await jwtVerify(accessToken, await this.publicKey(), {
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        algorithms: ['RS256'],
      });
      if (typeof payload.uid !== 'number' || typeof payload.sub !== 'string'
        || typeof payload.ver !== 'number') throw new Error('Incomplete access token.');
      const principal = await this.repository.getPrincipal(payload.uid);
      if (!principal || principal.publicId !== payload.sub || principal.tokenVersion !== payload.ver) {
        throw new Error('Access token was revoked.');
      }
      return principal;
    } catch {
      throw new HttpError(401, 'INVALID_ACCESS_TOKEN', 'Access token không hợp lệ hoặc đã hết hạn.');
    }
  }
}
