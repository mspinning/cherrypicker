export interface AppConfig {
  port: number;
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    synchronize: boolean;
  };
  keycloak: {
    /** URL the server uses to talk to Keycloak (Docker network) */
    internalUrl: string;
    /** URL clients use; determines the token issuer */
    publicUrl: string;
    realm: string;
    clientId: string;
    clientSecret: string;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  db: {
    host: required('DB_HOST'),
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    name: required('DB_NAME'),
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
  },
  keycloak: {
    internalUrl: required('KEYCLOAK_INTERNAL_URL').replace(/\/$/, ''),
    publicUrl: required('KEYCLOAK_PUBLIC_URL').replace(/\/$/, ''),
    realm: required('KEYCLOAK_REALM'),
    clientId: required('KEYCLOAK_CLIENT_ID'),
    clientSecret: required('KEYCLOAK_CLIENT_SECRET'),
  },
});
