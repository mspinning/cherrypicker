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
  knowledge: {
    /** Uploaded documents live here (a Docker volume in production) */
    storageDir: string;
    /** Upper limit per uploaded document */
    maxUploadBytes: number;
  };
  embedding: {
    /** OpenAI-compatible base URL of the Bifrost gateway; empty disables embeddings */
    baseUrl: string;
    /** Bifrost virtual key, sent as x-bf-vk */
    virtualKey: string;
    /** Bifrost model id, e.g. "ollama/bge-m3" or "openai/text-embedding-3-small" */
    model: string;
    /** Must match what the model returns; fixes the size of the vector column */
    dimensions: number;
  };
}

/** Read at import time by the chunk entity, which needs the vector size in its decorator. */
export const EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS ?? '1024', 10);

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
  knowledge: {
    storageDir: process.env.STORAGE_DIR ?? './storage',
    maxUploadBytes: parseInt(process.env.KNOWLEDGE_MAX_UPLOAD_MB ?? '50', 10) * 1024 * 1024,
  },
  embedding: {
    baseUrl: (process.env.BIFROST_URL ?? '').replace(/\/$/, ''),
    virtualKey: process.env.BIFROST_VIRTUAL_KEY ?? '',
    model: process.env.EMBEDDING_MODEL ?? 'ollama/bge-m3',
    dimensions: EMBEDDING_DIMENSIONS,
  },
});
