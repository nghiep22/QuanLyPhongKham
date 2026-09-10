export type ClinicRole = {
  code: string;
  branchId: number | null;
};

export type ClinicPrincipal = {
  userId: number;
  publicId: string;
  tokenVersion: number;
  roles: ClinicRole[];
};

export interface PrincipalRepository {
  getPrincipal(userId: number): Promise<ClinicPrincipal | null>;
}

export interface PrincipalAuthenticator {
  authenticate(accessToken: string): Promise<ClinicPrincipal>;
}
