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

/** Response of GET /api/users/me */
export interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  createdAt: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}
