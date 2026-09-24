import { TokenSet } from '../../keycloak/keycloak.service';

export class TokenResponseDto {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires */
  expiresIn: number;
  /** Seconds until the refresh token expires */
  refreshExpiresIn: number;
  tokenType: string;

  static from(tokens: TokenSet): TokenResponseDto {
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      refreshExpiresIn: tokens.refresh_expires_in,
      tokenType: tokens.token_type,
    };
  }
}
