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
- Nutzer, die direkt in Keycloak angelegt werden, bekommen ihr lokales Profil beim ersten Login automatisch. Fehlt das Profil (Konto gelöscht, Token noch gültig), antwortet `/users/me` mit `401`.

## Rollen und Freigabe

- Es gibt zwei Rollen: `user` und `admin`. Rolle und Freigabe stehen in der `users`-Tabelle (`role`, `approved_at`), nicht in Keycloak. Die Realm-Rollen in Keycloak wertet der Server nicht aus.
- **Der erste registrierte Nutzer** wird automatisch `admin` und ist sofort freigegeben. Ein Advisory Lock in Postgres sorgt dafür, dass es auch bei gleichzeitigen Registrierungen nur einen ersten Nutzer gibt.
- **Alle weiteren Nutzer** starten als `user` ohne Freigabe. Login und Token-Refresh antworten dann mit `403` und `{"code":"APPROVAL_PENDING"}`. Diese Antwort kommt erst nach erfolgreicher Passwortprüfung, sie verrät also nicht, ob eine E-Mail registriert ist.
- Admins sehen im Header einen Einstellungen-Button mit der Zahl wartender Konten. Unter `/settings/users` sehen sie alle Nutzer und können sie freigeben, ihre Rolle ändern und sie löschen.
- **Rolle ändern** geht nur bei freigegebenen Nutzern. **Löschen** entfernt auch das Keycloak-Konto, eine Anmeldung ist danach nicht mehr möglich. Beides ist für das eigene Konto gesperrt (`409`, `code: SELF`).
- **Es bleibt immer mindestens ein Admin.** Wer den letzten Admin herabstuft oder löscht, bekommt `409` mit `code: LAST_ADMIN`. Die Prüfung läuft unter demselben Advisory Lock, so bleibt auch bei gleichzeitigen Änderungen ein Admin übrig.
- Admin-Routen tragen `@Roles(UserRole.Admin)`. Der `RolesGuard` liest die Rolle bei jedem Request aus der Datenbank, Änderungen gelten also sofort.
- Gibt es beim Serverstart Nutzer, aber keinen Admin (z. B. Daten aus der Zeit vor den Rollen), wird der älteste Nutzer zum freigegebenen Admin.

## Wissensquellen

Unter `/settings/knowledge` pflegen Admins, was die Firmen der Gruppe anbieten. Später lesen Agenten dort nach, welche Firma welche Leistung hat und was in früheren Angeboten stand.

- **Firmen der Gruppe** (`group_companies`) mit Name und Kurzbeschreibung. Die Beschreibung hilft Agenten später, die richtige Firma zu wählen.
- Pro Firma gibt es drei Arten von **Quellen** (`knowledge_sources`), jeweils mit einer Kategorie (Leistung, Angebot, Referenz, Preise, Unternehmen, Sonstiges):
  - **Texte:** direkt im CRM geschrieben, bis 200.000 Zeichen.
  - **Webseiten:** URLs, mehrere auf einmal möglich. Der Server ruft sie im Hintergrund ab und liest den Hauptinhalt (ohne Navigation und Footer). Er liest nur die angegebene Seite, Unterseiten nicht. „Neu abrufen“ holt den aktuellen Stand.
  - **Dokumente:** PDF, Word (`.docx`), Text, Markdown, CSV und HTML bis `KNOWLEDGE_MAX_UPLOAD_MB` (Standard 50 MB) je Datei. Der Client lädt einzeln hoch, drei parallel, auch ganze Ordner. Dieselbe Datei (SHA-256) nimmt der Server pro Firma nur einmal an. Die Originale liegen im Volume `server-storage`.

### Verarbeitung

```
queued ──► processing ──► embedding ──► ready
             │ Text lesen,   │ Vektoren über
             │ in Abschnitte │ Bifrost holen
             ▼ teilen        │
           failed            └─ bei Fehlern: bleibt in "embedding", neuer Versuch mit Backoff
```

- Die Warteschlange ist die Tabelle selbst (`status = queued`, `FOR UPDATE SKIP LOCKED`). Ein Neustart verliert also nichts.
- **Abschnitte** (`knowledge_chunks`) sind etwa 1.400 Zeichen lang und überlappen sich um 200 Zeichen. Getrennt wird bevorzugt an Absätzen und Satzenden. Bei PDFs merkt sich jeder Abschnitt seine Seiten (`metadata.pages`).
- Vektorisiert wird jeder Abschnitt mit einem kurzen Kopf (`Firma · Kategorie · Titel (Seite n)`), damit der Vektor den Kontext kennt.
- Indexe: HNSW (`vector_cosine_ops`) für die Vektorsuche und GIN auf `to_tsvector('german', content)` für die Stichwortsuche. TypeORM kann beide nicht deklarieren, deshalb legt der Server sie beim Start selbst an.
- **Solange keine Vektoren entstehen können**, sind Texte trotzdem gespeichert und per Stichwort auffindbar. Die Einstellungen zeigen dann den Grund. Sobald Bifrost antwortet, holt der Server die Vektoren von selbst nach.
- Gescannte PDFs ohne Textebene landen in `failed`. OCR gibt es noch nicht.

### Embeddings einrichten

Die Embeddings laufen über Bifrost (`POST /v1/embeddings`). Bifrost hat Governance aktiv, der Server braucht deshalb einen Virtual Key.

1. Modell bereitstellen, z. B. lokal mit `ollama pull bge-m3` (mehrsprachig, 1024 Dimensionen).
2. In der Bifrost-UI (http://localhost:8081) den Provider einrichten und einen Virtual Key anlegen, der das Modell nutzen darf.
3. In `.env` setzen und den Server neu starten:
   ```bash
   BIFROST_VIRTUAL_KEY=...
   EMBEDDING_MODEL=ollama/bge-m3      # oder z. B. openai/text-embedding-3-small
   EMBEDDING_DIMENSIONS=1024          # muss zum Modell passen (text-embedding-3-small: 1536)
   ```

Wechselt das Modell, verwirft der Server beim Start die alten Vektoren und berechnet sie neu. Wechselt die Dimension, müssen die alten Vektoren vorher weg, sonst kann TypeORM die Spalte nicht ändern: `UPDATE knowledge_chunks SET embedding = NULL;`.

### Suche für Agenten

`KnowledgeSearchService.search()` (exportiert vom `KnowledgeModule`, per HTTP unter `POST /api/knowledge/search`) kombiniert Vektorsuche und deutsche Volltextsuche per Reciprocal Rank Fusion. Filtern lässt sich nach Firmen (`companyIds`) und Kategorien (`categories`). Jeder Treffer enthält den Abschnitt, die Quelle (Titel, URL oder Dateiname, Seiten) und die Firma. Ohne Embedding-Modell läuft die Stichwortsuche allein (`semantic: false`).

```bash
curl -X POST localhost:3000/api/knowledge/search -H "Authorization: Bearer <accessToken>" -H 'Content-Type: application/json' \
  -d '{"query":"Wer von uns kann eine Cloud-Migration mit 24/7-Betrieb anbieten?","limit":5}'
```

### Sicherheit beim Abruf von Webseiten

Der Server steht im selben Netz wie Postgres, Keycloak und Bifrost. Er ruft deshalb nur öffentliche Adressen ab. Die Prüfung läuft bei jedem Verbindungsaufbau, also auch nach Weiterleitungen und bei DNS-Rebinding. Private, Loopback- und Link-Local-Bereiche sind gesperrt. Dazu kommen Grenzen von 10 MB, 20 Sekunden und 5 Weiterleitungen.

## Endpunkte

| Methode | Pfad                 | Auth   | Body                                       |
|---------|----------------------|--------|--------------------------------------------|
| POST    | `/api/auth/register` | –      | `email`, `password`, `firstName`, `lastName` |
| POST    | `/api/auth/login`    | –      | `email`, `password`                        |
| POST    | `/api/auth/refresh`  | –      | `refreshToken`                             |
| POST    | `/api/auth/logout`   | –      | `refreshToken`                             |
| GET     | `/api/users/me`      | Bearer | –                                          |
| GET     | `/api/users`         | Admin  | –                                          |
| POST    | `/api/users/:id/approve` | Admin | –                                      |
| PATCH   | `/api/users/:id/role`    | Admin | `role` (`user` \| `admin`)            |
| DELETE  | `/api/users/:id`         | Admin | –                                      |
| GET     | `/api/knowledge`                           | Admin | – (Firmen mit Zählern, Embedding-Status, Upload-Grenzen) |
| POST    | `/api/knowledge/companies`                 | Admin | `name`, `description`                  |
| PATCH   | `/api/knowledge/companies/:id`             | Admin | `name`, `description`                  |
| DELETE  | `/api/knowledge/companies/:id`             | Admin | – (inkl. aller Quellen und Dateien)    |
| GET     | `/api/knowledge/companies/:id/sources`     | Admin | Query: `type`, `category`, `state`, `q`, `offset`, `limit` |
| POST    | `/api/knowledge/companies/:id/texts`       | Admin | `title`, `category`, `content`         |
| POST    | `/api/knowledge/companies/:id/urls`        | Admin | `urls[]`, `category`                   |
| POST    | `/api/knowledge/companies/:id/documents`   | Admin | multipart: `file`, `category`          |
| POST    | `/api/knowledge/companies/:id/reprocess-failed` | Admin | –                                 |
| GET     | `/api/knowledge/sources/:id`               | Admin | – (mit vollem Text)                    |
| PATCH   | `/api/knowledge/sources/:id`               | Admin | `title`, `category`, `content` (nur Texte) |
| POST    | `/api/knowledge/sources/:id/reprocess`     | Admin | –                                      |
| GET     | `/api/knowledge/sources/:id/file`          | Admin | – (Original-Datei)                     |
| DELETE  | `/api/knowledge/sources/:id`               | Admin | –                                      |
| POST    | `/api/knowledge/search`                    | Admin | `query`, `companyIds[]`, `categories[]`, `limit` |
| POST    | `/api/knowledge/embedding/retry`           | Admin | – (Backoff überspringen)               |
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
