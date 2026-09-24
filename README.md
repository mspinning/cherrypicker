# AI First CRM

Schritt 1: Infrastruktur und Benutzerverwaltung (Registrierung und Anmeldung).

## Stack

| Service    | Image                            | Port | Zweck                                             |
|------------|----------------------------------|------|---------------------------------------------------|
| `postgres` | `pgvector/pgvector:pg17`         | 5432 | CRM-Datenbank (`vector` aktiv) und Keycloak-DB    |
| `keycloak` | `quay.io/keycloak/keycloak:26.3` | 8080 | Identity Provider, Realm `crm` wird automatisch importiert |
| `server`   | `./server` (NestJS 11, Node 22)  | 3000 | REST-API                                          |

## Start

```bash
cp .env.example .env   # Passwörter und Client-Secret anpassen
docker compose up -d --build
```

- API: http://localhost:3000/api
- Swagger: http://localhost:3000/api/docs
- Keycloak-Admin: http://localhost:8080 (Zugangsdaten aus `.env`)

## Architektur Auth

```
Client ──► NestJS ──► Keycloak (Realm "crm", Client "crm-backend")
                │
                └──► Postgres (Tabelle users: lokales CRM-Profil, verknüpft über keycloak_id)
```

- **Passwörter liegen ausschließlich in Keycloak.** Die `users`-Tabelle enthält nur das Profil und die `keycloak_id` (= Token-`sub`).
- **Registrierung:** Der Server legt den Nutzer über die Keycloak Admin API an. Dafür nutzt er den Service-Account von `crm-backend` mit den Rollen `manage-users`, `view-users` und `query-users`. Danach legt er das lokale Profil an. Scheitert dieser zweite Schritt, löscht der Server den Keycloak-Nutzer wieder.
- **Login:** Der Server fordert die Tokens über den OIDC Token-Endpoint an (Direct Access Grant).
- **Schutz:** Ein globaler `JwtAuthGuard` prüft jeden Request anhand von JWKS-Signatur, Issuer, Ablaufzeit und `azp`. Öffentliche Routen tragen `@Public()`.
- Nutzer, die direkt in Keycloak angelegt werden, bekommen ihr lokales Profil beim ersten Aufruf von `/users/me` automatisch.

## Endpunkte

| Methode | Pfad                 | Auth   | Body                                       |
|---------|----------------------|--------|--------------------------------------------|
| POST    | `/api/auth/register` | –      | `email`, `password`, `firstName`, `lastName` |
| POST    | `/api/auth/login`    | –      | `email`, `password`                        |
| POST    | `/api/auth/refresh`  | –      | `refreshToken`                             |
| POST    | `/api/auth/logout`   | –      | `refreshToken`                             |
| GET     | `/api/users/me`      | Bearer | –                                          |
| GET     | `/api/health`        | –      | –                                          |

```bash
curl -X POST localhost:3000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"max@example.com","password":"Sehr-Geheim-123","firstName":"Max","lastName":"Muster"}'

curl -X POST localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"max@example.com","password":"Sehr-Geheim-123"}'

curl localhost:3000/api/users/me -H "Authorization: Bearer <accessToken>"
```

## Hinweise

- **Realm-Import:** `docker/keycloak/crm-realm.json` wird nur importiert, wenn der Realm noch nicht existiert. Änderungen an der Datei greifen erst nach `docker compose down -v`. Dieser Befehl löscht alle Daten.
- **Postgres-Init:** `docker/postgres/init.sh` läuft nur bei leerem Volume. Das Skript legt die Extensions `vector` und `pgcrypto` sowie die Keycloak-Datenbank an.
- **`DB_SYNCHRONIZE=true`** erzeugt die Tabellen aus den Entities. Das ist nur für die Entwicklung gedacht. Vor Produktion auf TypeORM-Migrations umstellen.
- **Keycloak läuft im `start-dev`-Modus** (HTTP, kein Caching der Themes). Für Produktion `start` mit TLS und `KC_HOSTNAME` verwenden.
- **Direct Access Grant** (Passwort über das Backend) ist für ein API-first-Setup pragmatisch, gilt nach OAuth 2.1 aber als Legacy. Sobald ein Web-Frontend dazukommt, empfiehlt sich der Authorization Code Flow mit PKCE über einen eigenen Public Client.

## Lokale Entwicklung ohne Docker für den Server

```bash
docker compose up -d postgres keycloak
cd server && npm install
DB_HOST=localhost DB_PORT=5432 DB_USER=crm DB_PASSWORD=change-me-postgres DB_NAME=crm DB_SYNCHRONIZE=true \
KEYCLOAK_INTERNAL_URL=http://localhost:8080 KEYCLOAK_PUBLIC_URL=http://localhost:8080 \
KEYCLOAK_REALM=crm KEYCLOAK_CLIENT_ID=crm-backend KEYCLOAK_CLIENT_SECRET=change-me-client-secret \
npm run start:dev
```
