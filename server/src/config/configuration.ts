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
    /** Bifrost model id, e.g. "ollama/bge-m3:latest" or "openai/text-embedding-3-small" */
    model: string;
    /** Must match what the model returns; fixes the size of the vector column */
    dimensions: number;
  };
  llm: {
    /** Same Bifrost gateway as the embeddings */
    baseUrl: string;
    virtualKey: string;
    /** Chat model for classifying mail relationships, e.g. "anthropic/claude-sonnet-5-5"; empty disables the mail import */
    model: string;
  };
  /** URL the browser uses to reach the app (Caddy or ng serve); OAuth callbacks are built from it */
  appPublicUrl: string;
  microsoft: {
    clientId: string;
    clientSecret: string;
    /** Directory (tenant) id of a single-tenant app, or "organizations" / "common" for multi-tenant apps */
    tenantId: string;
    redirectUri: string;
  };
  integrations: {
    /** Encrypts OAuth tokens at rest; empty disables integrations */
    encryptionKey: string;
  };
  mailImport: {
    /** Mail domains of the own group besides the users' own ones; never imported as customers */
    internalDomains: string[];
  };
  tasks: {
    /** Fills "Heute" with demo tasks for approved users who have none; for development and demos */
    seedDemo: boolean;
  };
  voice: {
    /** Chat model that hears audio and writes down what was said, e.g. "ollama/cherrypick-stt:latest"; empty disables voice calls */
    sttModel: string;
    /** Chat model with tool calling that leads the call and creates the tasks; LLM_MODEL if not set */
    agentModel: string;
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

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export default (): AppConfig => {
  const appPublicUrl = (process.env.APP_PUBLIC_URL ?? 'http://localhost').replace(/\/$/, '');
  const bifrostUrl = (process.env.BIFROST_URL ?? '').replace(/\/$/, '');
  return {
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
      baseUrl: bifrostUrl,
      virtualKey: process.env.BIFROST_VIRTUAL_KEY ?? '',
      model: process.env.EMBEDDING_MODEL ?? 'ollama/bge-m3:latest',
      dimensions: EMBEDDING_DIMENSIONS,
    },
    llm: {
      baseUrl: bifrostUrl,
      virtualKey: process.env.BIFROST_VIRTUAL_KEY ?? '',
      model: process.env.LLM_MODEL ?? '',
    },
    appPublicUrl,
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID ?? '',
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? '',
      tenantId: process.env.MICROSOFT_TENANT_ID || 'organizations',
      redirectUri: process.env.MICROSOFT_REDIRECT_URI || `${appPublicUrl}/api/integrations/microsoft/callback`,
    },
    integrations: {
      encryptionKey: process.env.INTEGRATIONS_ENCRYPTION_KEY ?? '',
    },
    mailImport: {
      internalDomains: list(process.env.MAIL_IMPORT_INTERNAL_DOMAINS),
    },
    tasks: {
      seedDemo: process.env.SEED_DEMO_TASKS === 'true',
    },
    voice: {
      sttModel: process.env.VOICE_STT_MODEL ?? '',
      agentModel: process.env.VOICE_AGENT_MODEL || process.env.LLM_MODEL || '',
    },
  };
};
