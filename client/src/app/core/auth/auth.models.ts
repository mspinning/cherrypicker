/** Response of POST /api/auth/login and /api/auth/refresh */
export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  /** seconds */
  expiresIn: number;
  /** seconds */
  refreshExpiresIn: number;
  tokenType: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** epoch ms */
  expiresAt: number;
  /** epoch ms */
  refreshExpiresAt: number;
}

export type UserRole = 'user' | 'admin';

/** Response of GET /api/users/me, also one entry of GET /api/users */
export interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  /** false until an admin has approved the account; such users cannot sign in */
  approved: boolean;
  approvedAt: string | null;
  createdAt: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}
