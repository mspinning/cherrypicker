#!/bin/bash
# Runs once on first start of an empty data volume.
set -euo pipefail

# pgvector for the CRM database (embeddings / semantic search), pg_trgm for
# finding customers by a name that was only heard (voice calls)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EOSQL

# Separate database + role for Keycloak
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE ${KEYCLOAK_DB_USER} WITH LOGIN PASSWORD '${KEYCLOAK_DB_PASSWORD}';
  CREATE DATABASE ${KEYCLOAK_DB} OWNER ${KEYCLOAK_DB_USER};
EOSQL
