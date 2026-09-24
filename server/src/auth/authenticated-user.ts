/** Claims of a verified Keycloak access token, attached to `request.user`. */
export interface AuthenticatedUser {
  sub: string;
  email?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
  realm_access?: { roles: string[] };
}
