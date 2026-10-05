# AI First CRM

Schritt 1: Infrastruktur und Benutzerverwaltung (Registrierung und Anmeldung).

## Stack

| Service    | Image                            | Port | Zweck                                             |
|------------|----------------------------------|------|---------------------------------------------------|
| `postgres` | `pgvector/pgvector:pg17`         | 5432 | CRM-Datenbank (`vector` aktiv) und Keycloak-DB    |
| `keycloak` | `quay.io/keycloak/keycloak:26.3` | 8080 | Identity Provider, Realm `crm` wird automatisch importiert |
| `server`   | `./server` (NestJS 11, Node 22)  | 3000 | REST-API                                          |
| `client`   | `./client` (Angular 22, Caddy 2) | 80/443 | Web-App und Proxy für `/api`                    |

## Start

```bash
cp .env.example .env   # Passwörter und Client-Secret anpassen
docker compose up -d --build
```

- Web-App: http://localhost
- API: http://localhost:3000/api (oder über Caddy: http://localhost/api)
- Swagger: http://localhost:3000/api/docs
- Keycloak-Admin: http://localhost:8080 (Zugangsdaten aus `.env`)

## Auslieferung des Frontends

```
Browser ──► Caddy (client) ──┬─ /api/*  ──► server:3000
                             └─ sonst   ──► /srv (Angular-Build)
```

- `client/Dockerfile` baut die App mit `ng build` und kopiert `dist/client/browser` in ein `caddy:2-alpine`-Image. Die Konfiguration steht in `client/Caddyfile`.
- Browser und API teilen sich eine Origin, genau wie beim Dev-Server mit `proxy.conf.json`. Der Client ruft weiter relativ `/api` auf, CORS spielt keine Rolle.
- Unbekannte Pfade (`/settings/users` usw.) liefern `index.html`, das Routing übernimmt Angular.
- Gebündelte Dateien mit Hash im Namen (`main-XFNATKPP.js`) cacht der Browser ein Jahr. `index.html` und die Favicons prüft er bei jedem Aufruf neu. So greift ein neuer Build sofort.
- **HTTPS:** `SITE_ADDRESS` in `.env` auf die Domain setzen (z. B. `crm.example.com`). Caddy holt und erneuert die Zertifikate dann selbst, die Ports 80 und 443 müssen dafür von außen erreichbar sein. Die Zertifikate liegen im Volume `caddy-data`.
- Der Server ist weiter direkt auf Port 3000 erreichbar (Swagger, `curl`). In Produktion reicht Caddy als einziger offener Eingang, das Port-Mapping von `server` kann dann weg.

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

1. Modell bereitstellen, z. B. lokal mit `ollama pull bge-m3` (mehrsprachig, 1024 Dimensionen, in Bifrost `ollama/bge-m3:latest`).
2. In der Bifrost-UI (http://localhost:8081) den Provider einrichten und einen Virtual Key anlegen, der das Modell nutzen darf. Bei Ollama danach „Refresh model list“ ausführen, damit Bifrost das neue Modell kennt.
3. In `.env` setzen und den Server neu starten:
   ```bash
   BIFROST_VIRTUAL_KEY=...
   EMBEDDING_MODEL=ollama/bge-m3:latest   # Name genau wie in Ollama gelistet, sonst lehnt der Virtual Key ab; oder z. B. openai/text-embedding-3-small
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

## Microsoft 365 und Kundenimport

Im Profil verbindet jeder Nutzer sein Microsoft-365-Konto. Das CRM darf dann Mails lesen sowie Kalendertermine lesen und schreiben (delegierte Berechtigungen `Mail.Read`, `Calendars.ReadWrite`, `User.Read`, `offline_access`). Danach erkennt ein Import die Kunden in den Mails und legt Firmen und Ansprechpartner an. Unter **Kunden** (Menü oben) sind sie für alle Nutzer zu finden.

### Einrichtung (einmalig)

1. **App registrieren** im [Microsoft Entra Admin Center](https://entra.microsoft.com) unter „App-Registrierungen“ → „Neue Registrierung“:
   - Kontotypen: „Nur Konten in diesem Organisationsverzeichnis“. `MICROSOFT_TENANT_ID` ist dann die Verzeichnis-ID (Mandanten-ID). Bei einer mandantenfähigen App bleibt `organizations` stehen.
   - Umleitungs-URI, Plattform **Web**: `${APP_PUBLIC_URL}/api/integrations/microsoft/callback`, also `http://localhost/api/integrations/microsoft/callback` (Caddy) bzw. `http://localhost:4200/…` (ng serve) oder `https://crm.example.com/…`. Microsoft erlaubt `http` nur für `localhost`. Der Server nutzt genau eine URI. Steht sie nicht in `APP_PUBLIC_URL`, kann `MICROSOFT_REDIRECT_URI` sie überschreiben.
2. Unter „Zertifikate & Geheimnisse“ einen **geheimen Clientschlüssel** anlegen und als `MICROSOFT_CLIENT_SECRET` eintragen. Er läuft ab (max. 24 Monate) und muss dann erneuert werden. Die „Anwendungs-ID (Client)“ kommt in `MICROSOFT_CLIENT_ID`.
3. Unter „API-Berechtigungen“ → Microsoft Graph → **Delegiert**: `User.Read`, `Mail.Read`, `Calendars.ReadWrite`, `offline_access`. Dürfen Nutzer im Tenant nicht selbst zustimmen, erteilt ein Admin dort die „Administratorzustimmung“.
4. In `.env` setzen und den Server neu bauen (`docker compose up -d --build server`):
   ```bash
   APP_PUBLIC_URL=http://localhost
   MICROSOFT_CLIENT_ID=…
   MICROSOFT_CLIENT_SECRET=…
   MICROSOFT_TENANT_ID=…
   INTEGRATIONS_ENCRYPTION_KEY=$(openssl rand -base64 32)   # den Wert eintragen, nicht den Befehl
   LLM_MODEL=anthropic/claude-sonnet-5-5
   ```
5. **Chat-Modell in Bifrost:** Provider (z. B. Anthropic) einrichten und das Modell aus `LLM_MODEL` im selben Virtual Key wie das Embedding-Modell erlauben. Sonst antwortet Bifrost mit „Model … is not allowed for virtual key“. Lokal geht auch Ollama (`ollama/qwen3.5:latest`), das ist aber deutlich langsamer (rund 45 Sekunden pro Gegenseite) und ordnet ungenauer ein.

Fehlt etwas, zeigt das Profil-Panel Admins, welche Variablen fehlen und welche Redirect-URI zu registrieren ist.

### Verbindung

```
Profil ─ POST /connect ─► URL + Cookie ─► login.microsoftonline.com ─► GET /callback ─► Tokens verschlüsselt speichern ─► /profile?microsoft=connected
```

- Authorization Code Flow mit **PKCE** und Client-Secret. Der `state` ist mit AES-256-GCM verschlüsselt und enthält CRM-Nutzer, PKCE-Verifier und Ablauf (10 Minuten). Ein HttpOnly-Cookie bindet ihn an den Browser, der die Anmeldung gestartet hat. So kann niemand einem anderen einen fremden Anmeldelink unterschieben und dessen Postfach an sein eigenes CRM-Konto hängen.
- **Tokens** (Refresh und Access) liegen nur verschlüsselt in `microsoft_connections` und verlassen den Server nie. Microsoft rotiert den Refresh-Token, der Server speichert jeweils den neuesten.
- Ist der Refresh-Token ungültig (Zustimmung entzogen, Passwort geändert, 90 Tage Inaktivität oder geänderter `INTEGRATIONS_ENCRYPTION_KEY`), steht die Verbindung auf `reauth_required`. Das Profil zeigt dann „Neu verbinden“.
- Ein Postfach gehört genau einem CRM-Nutzer, sonst würden seine Mails doppelt zählen.
- **Trennen** löscht die Tokens und bricht laufende Importe ab. Importierte Kunden bleiben. Die Zustimmung selbst entfernt der Nutzer unter myapps.microsoft.com.

### Erstimport

```
queued ──► scanning ──────────────────► analyzing ─────────────────────────────► done
           │ Mail-Köpfe lesen (Graph),   │ je Gegenseite: Regeln, sonst LLM;
           │ nach Gegenseite gruppieren  │ Kunden/Interessenten ins CRM
           ▼                             ▼
         failed / cancelled
```

- **Testlauf:** nur die neuesten 50 bis 1.000 Mails. Unter „Entscheidungen ansehen“ steht für jede Gegenseite, ob sie übernommen oder aussortiert wurde und warum. **Vollständig:** alle Mails der letzten 6 bis 36 Monate oder das ganze Postfach.
- **Gegenseite** heißt eine geschäftliche Domain (`acme.de`, Subdomains zusammengefasst) oder bei Freemail (`gmx.de`, `gmail.com`, …) eine einzelne Adresse. Nicht berücksichtigt werden: eigene Adressen, Domains aller CRM-Nutzer und `MAIL_IMPORT_INTERNAL_DOMAINS` (Kollegen), automatische Absender (`noreply@`, `notifications@`, …), Entwürfe, Junk, Papierkorb und Postausgang.
- **Regeln vor dem LLM:** bekannte Dienste (GitHub, OpenAI, Microsoft, Stripe, … in `mail-import/addresses.ts`) gelten als Dienstleister. Domains, die nur schreiben und von Outlook unter „Sonstige“ einsortiert werden, gelten als Newsletter. Frühere sichere Entscheidungen (`crm_party_decisions`) werden wiederverwendet.
- **LLM:** liest pro Gegenseite die neuesten Mails (4 eingehende mit Signatur, 2 eigene, nur der neue Teil ohne Zitate) und Betreff und Vorschau von bis zu 15 weiteren. Es kennt die Firmen der Gruppe aus den Wissensquellen und ordnet ein: `customer`, `prospect`, `partner`, `vendor`, `notification`, `newsletter`, `internal`, `private` oder `unknown`. **Ins CRM kommen nur `customer` und `prospect` ab 60 % Sicherheit.** Wer uns etwas verkaufen will, gilt als Dienstleister, nie als Interessent. Die Antwort kommt als erzwungener Tool-Call und wird streng geprüft: Kontakte nur mit Adressen, die in den Mails vorkommen.
- **Keine Duplikate:**
  - Firmen werden über ihre Mail-Domain gefunden (`crm_company_domains`, Primärschlüssel), dann über den normalisierten Namen („ACME GmbH & Co. KG“ = „acme“). `acme.de` und `acme.com` mit gleichem Namen landen bei einer Firma, gleichnamige Firmen mit verschiedenen Domains nicht.
  - Personen werden über jede ihrer Adressen gefunden, dann über den Namen innerhalb der Firma (die zweite Adresse kommt in `other_emails`).
  - Bestehende Werte werden nie überschrieben, nur Lücken gefüllt. Interessent wird zu Kunde, nie umgekehrt. Die Zusammenfassung der Beziehung ist immer die neueste.
  - Jede Mail wird pro Firma nur einmal als Aktivität gespeichert (unveränderliche Graph-IDs). Ein zweiter Import ergänzt nur Neues.
  - Alle Merges laufen unter einem Advisory Lock.
- **Erfasst** werden je Firma Name, Domains, Webseite, Branche, Beschreibung, Telefon, Adresse, Beziehung (Kunde/Interessent), Zusammenfassung, Themen sowie erster und letzter Kontakt. Je Person: Name, Position, Abteilung, Telefon, Mobil, LinkedIn, Adressen, erster und letzter Kontakt. Dazu kommen die Mails als Aktivitäten (Betreff, Vorschau, Richtung, Link zu Outlook).
- **Datenschutz:** Firmen und Personen sehen alle CRM-Nutzer. Mail-Aktivitäten sieht nur der Postfach-Inhaber, die anderen sehen bei einer Firma nur „Kontakt über: Name · Anzahl Mails“. Mail-Texte werden nicht gespeichert, nur Betreff und Graphs Vorschauzeile (bis 300 Zeichen). Gelesene Mail-Ausschnitte gehen zur Einordnung an das konfigurierte LLM.
- **Löschen** einer Firma entfernt ihre Personen und Aktivitäten. Mit „Bei künftigen Importen ignorieren“ merkt sich das CRM ihre Domains, kein späterer Import legt sie wieder an. Bei Privatkontakten gilt das für die Adresse.
- Wie bei den Wissensquellen ist die Tabelle `mail_import_jobs` die Warteschlange. Nach einem Neustart beginnt ein unterbrochener Scan neu, eine laufende Analyse macht mit den offenen Gegenseiten weiter. Pro Nutzer läuft höchstens ein Import (partieller Unique-Index), insgesamt zwei gleichzeitig, je Import werden drei Gegenseiten parallel eingeordnet. Graph-Throttling (429, `Retry-After`) wird abgewartet. Antwortet das LLM mehrmals hintereinander nicht oder ist es falsch konfiguriert, bricht der Import mit einer Meldung im Profil ab.
- Ausgelegt auf **eine** Server-Instanz, wie die Wissensquellen.

### Kalender

`CalendarService` (exportiert vom `MicrosoftModule`) und `/api/calendar/events` lesen Termine (Serien aufgelöst, in UTC) und legen Termine an, ändern und löschen sie, auf Wunsch mit Teams-Link und Einladungen. Das Profil zeigt die nächsten Termine. Gedacht ist das für die nächste Ausbaustufe, damit freigegebene „Termin“-Vorschläge direkt im Kalender landen.

### Nächste Ausbaustufe

Der regelmäßige Abgleich im Hintergrund für alle verbundenen Nutzer (neueste Mails → Vorschläge für die nächste beste Opportunity) kann auf Folgendem aufbauen: `GraphClient`, `CrmMergeService`, die Entscheidungen in `crm_party_decisions` (bekannte Dienstleister kosten keinen LLM-Aufruf), unveränderliche Mail-IDs und `MicrosoftEvents`. Für das inkrementelle Lesen bietet sich die Delta-Abfrage von Graph an (`/me/mailFolders/{id}/messages/delta`).

## Aufgaben („Heute“)

Die Karten auf „Heute“ sind Zeilen der Tabelle `tasks`. Jede Aufgabe gehört genau einem Vertriebsmitarbeiter (`assignee_id` → `users`, wird mit dem Nutzer gelöscht). Jeder sieht und entscheidet nur seine eigenen, fremde Aufgaben beantwortet die API mit `404`.

- **Herkunft:** Aufgaben entstehen aus Sprachanrufen (siehe „Sprachanruf mit Cherry“) und, solange es keine echten gibt, als Demo-Aufgaben.
- **Inhalt:** Art (`mail`, `call`, `offer`, `meeting`), Titel, Kontakt und Deal als Momentaufnahme für die Karte (noch ohne Verknüpfung zu `crm_contacts`), Entwurf, Begründung mit gewichteten Belegen (`evidence`, JSONB), bester Zeitpunkt (`due_at`) und letzter Kontakt als Zeitstempel. Texte wie „vor 9 Tagen“ oder „Heute, 10:00 Uhr“ rechnet der Client daraus.
- **Entscheidung:** `status` ist `open`, `approved` oder `rejected`, dazu `decided_at`. Wer den Entwurf vor der Freigabe ändert, dessen Text steht in `final_draft`, der Vorschlag in `draft` bleibt erhalten. „Rückgängig“ öffnet die Aufgabe wieder.
- **Heute-Ansicht:** `GET /api/tasks?decidedSince=<Tagesbeginn>` liefert zuerst die seit Tagesbeginn entschiedenen Aufgaben in der Reihenfolge der Entscheidung, dann die offenen nach `due_at`. Die Entscheidungen überstehen so ein Neuladen, am nächsten Tag sind sie aus der Liste verschwunden.
- **Demo-Aufgaben:** Mit `SEED_DEMO_TASKS=true` (Standard in `docker-compose.yml`) bekommt beim Serverstart jeder freigegebene Nutzer, der noch keine Aufgabe hat, sieben Demo-Aufgaben (`server/src/tasks/demo-tasks.ts`), signiert mit seinem Vornamen. Wer später freigegeben wird, bekommt sie beim nächsten Start. „Demo neu starten“ öffnet alle entschiedenen Aufgaben des Nutzers wieder, auch die früherer Tage.
- Eine Freigabe löst noch nichts aus (kein Versand, kein Kalendereintrag). Die nächste Ausbaustufe schreibt auch Vorschläge aus dem Postfach in dieselbe Tabelle.

## Sprachanruf mit Cherry

Über den Knopf „Cherry anrufen“ im Header berichtet man der Assistentin per Sprache von einem Kundenkontakt („Habe Thomas Becker von Nordwerk auf der Hannover Messe getroffen, er will mehr Infos zu HUB.KI, bis Freitag ein Angebot“) oder lässt einen neuen Kunden anlegen. Das sieht aus wie ein Telefonat: auf dem Handy bildschirmfüllend, am Desktop als Karte in Handygröße. Der Knopf erscheint nur, wenn `VOICE_STT_MODEL` gesetzt ist.

### Ablauf

1. **Sprechen:** Der Browser nimmt über das Mikrofon auf und erkennt selbst, wann jemand spricht und wann er fertig ist (Lautstärke gegen das Grundrauschen, 1,3 Sekunden Pause beenden einen Beitrag; ein Tipp auf Cherry beendet ihn sofort). Jeder Beitrag geht als WAV (16 kHz, mono) an `POST /api/voice/calls/:id/turns`. Gespeichert wird nur der Text, nie die Aufnahme.
2. **Verstehen:** Der Server lässt die Aufnahme von einem Modell transkribieren, das Audio versteht (`VOICE_STT_MODEL`). Als Schreibhilfe bekommt es die Namen der eigenen Firmen, die Produktnamen aus den Titeln der Wissensquellen und die Kunden, die im Anruf schon gefunden wurden.
3. **Antworten:** Der Agent (`VOICE_AGENT_MODEL`, sonst `LLM_MODEL`) schaut im CRM nach, ob es Firma und Person schon gibt (`kunden_suchen`, findet per `pg_trgm` auch „Kessler“ für „Kässler & Söhne GmbH“), kann die Wissensbasis befragen (`wissen_suchen`) und antwortet in ein bis zwei Sätzen. Die Antwort liest der Browser mit der Stimme des Geräts vor (Web Speech API). Während des Anrufs wird nichts gespeichert, Korrekturen („nein, Bäcker mit ä“) kosten also nichts.
4. **Auflegen:** Mit dem roten Knopf, oder Cherry legt auf, wenn man sich verabschiedet. Erst jetzt schreibt der Agent: `kunde_speichern` legt Firma und Ansprechpartner an oder ergänzt sie (vorhandene Angaben werden nie überschrieben) und hängt eine Notiz zum Gespräch an, `aufgabe_anlegen` erzeugt je nächstem Schritt eine Aufgabe mit fertigem Entwurf für den Anrufer. Die Aufgaben erscheinen unter „Heute“ und werden dort wie alle anderen freigegeben oder verworfen. Der Bildschirm zeigt die Schritte live und danach, was entstanden ist. Wer nicht warten will, lässt es im Hintergrund fertig werden. Auch ein geschlossener Tab zählt als Auflegen.

Antworten auf Beiträge und das Aufräumen nach dem Anruf kommen als Event-Stream (`text/event-stream`, je Ereignis eine Zeile `data: {…}`): `heard` (verstandener Text), `step` (was der Agent gerade tut), `reply` (Antwort, `hangup: true` beim Abschied), `silence`, `result`, `error`.

- **Ohne Mikrofon** (Zugriff verweigert, oder die Seite läuft nicht über HTTPS bzw. `localhost`) kann man im Anruf tippen. **Auf dem Handy braucht das Mikrofon HTTPS**, also `SITE_ADDRESS` mit einer Domain.
- **Fälligkeiten** rechnet der Server aus, nicht das Modell: Das Modell nennt nur „donnerstag“ und „naechste“, daraus wird das Datum in der Zeitzone des Geräts. Samstag und Sonntag rutschen auf den Freitag davor, ohne genannten Tag gilt die nächste volle Stunde in der Bürozeit.
- **Notizen** (`crm_notes`) sehen alle CRM-Nutzer an Firma und Kontakt, anders als die Mails aus dem eigenen Postfach. Kontakte aus einem Anruf dürfen ohne Mailadresse angelegt werden. Ist eine genannt, wird ihre Domain der Firma zugeordnet, damit der Mail-Import sie später wiederfindet.
- **Protokoll:** `voice_calls` hält je Anruf den Wortlaut (`turns`), den Verlauf des Agenten samt Werkzeugaufrufen (`messages`) und das Ergebnis.

### Modelle über Ollama

Alle Modelle laufen lokal über Ollama und werden wie bisher über Bifrost angesprochen. `docker/ollama/setup.sh` lädt sie und startet Bifrost neu, damit es die neue Modellliste kennt:

| Zweck | Modell in Ollama | `.env` |
|-------|------------------|--------|
| Embeddings der Wissensbasis | `bge-m3` | `EMBEDDING_MODEL=ollama/bge-m3:latest` |
| Mail-Import und Anruf-Agent | `qwen3.8` | `LLM_MODEL=ollama/qwen3.8:latest` |
| Spracherkennung | `cherrypick-stt` (Gemma 4 E4B) | `VOICE_STT_MODEL=ollama/cherrypick-stt:latest` |

- **Spracherkennung ohne Whisper:** Ollama kann Audio nur über Modelle, die selbst hören, etwa Gemma 4 E4B. Bifrosts eigener Endpunkt `/v1/audio/transcriptions` erreicht Ollama nicht („not supported by ollama provider“), deshalb schickt der Server die Aufnahme als Audio-Teil einer normalen Chat-Anfrage. 15 Sekunden Sprache sind so in unter einer Sekunde Text.
- **`cherrypick-stt` ist Gemma 4 E4B mit kleinem Kontext** (`docker/ollama/cherrypick-stt.Modelfile`). Mit dem Standardkontext von 128k entlädt Ollama bei jedem Wechsel zwischen Spracherkennung und Agent das jeweils andere Modell, was jede Antwort um sechs bis zehn Sekunden verzögert. Mit 8k bleiben beide geladen.
- **Sprachausgabe** gibt es in Ollama nicht. Cherry spricht mit der Stimme des Geräts, ohne Modell und ohne Server. Bevorzugt werden Stimmen, die auf dem Gerät selbst laufen.
- **Tempo** auf einem M5 Max: Eine Antwort im Gespräch kommt nach ein bis sieben Sekunden (am längsten, wenn der Agent im CRM und in der Wissensbasis nachschaut), das Aufräumen danach braucht etwa 15 Sekunden je Aufgabe. Der Agent läuft ohne „Thinking“ (`reasoning_effort: none`), mit dauerte das Aufräumen doppelt so lang.
- Für ein gehostetes Modell genügt es, `VOICE_AGENT_MODEL` bzw. `VOICE_STT_MODEL` umzustellen. Das Modell für die Spracherkennung muss Audio in Chat-Anfragen annehmen (`input_audio`).

## LinkedIn-Nachrichten (Chrome-Erweiterung)

Der LinkedIn-Button im Header (links neben Einstellungen und Profil) schaut nach neuen LinkedIn-Nachrichten. Dafür nutzt er die LinkedIn-Anmeldung, die im Browser schon besteht. Gibt es keine, meldet das CRM das nur. Es meldet sich nie selbst an.

```
CRM-Seite ─ postMessage ─► bridge.js (Content-Script auf dem CRM)
                               │ chrome.runtime.connect
                               ▼
                          background.js ─► Tab linkedin.com/messaging/thread/new/
                               │             (Sitzung prüfen, Liste lesen: inbox-reader.js)
                               ▼
CRM-Seite ◄─ Fortschritt und Ergebnis ─┘   danach zurück zum CRM-Tab
```

- **Eigene Erweiterung statt Browser MCP.** Browser MCP verbindet KI-Clients (Cursor, Claude Desktop) über einen lokalen MCP-Server mit dem Browser. Eine Web-App kann ihn nicht direkt ansprechen. Für den festen Ablauf „LinkedIn öffnen, Posteingang lesen“ braucht es weder MCP noch ein LLM.
- **Quelle:** `client/chrome-extension/` (Manifest V3). Der Build liefert den Ordner unter `/chrome-extension/` mit aus (`angular.json`, Assets).
- **Erkennung:** Beim Klick fragt das CRM per `postMessage`, ob die Bridge antwortet (800 ms). Ohne Antwort zeigt das Panel die Installation. Nach der Installation verbindet sich die Erweiterung mit offenen CRM-Tabs, das Panel macht dann von selbst weiter.
- **Installation:** „Erweiterung herunterladen“ packt die Dateien im Browser zu `cherrypick-linkedin.zip`. Das Manifest wird dabei auf den Host angepasst, von dem das CRM kommt (z. B. `https://crm.example.com/*`), alle Ports eingeschlossen. Danach unter `chrome://extensions` den Entwicklermodus einschalten und „Entpackte Erweiterung laden“. Für die Entwicklung lässt sich `client/chrome-extension/` direkt laden, das Manifest dort gilt für `http://localhost`.
- **Ablauf:** Ein offener Messaging-Tab wird wiederverwendet, sonst öffnet die Erweiterung `/messaging/thread/new/`. Diese Ansicht zeigt die Liste, ohne eine Unterhaltung zu öffnen. Unter `/messaging/` würde LinkedIn die neueste Unterhaltung öffnen und als gelesen markieren. Der Tab steht beim Lesen vorn, weil Chrome Hintergrund-Tabs nicht fertig rendert. Danach wechselt Chrome zurück zum CRM.
- **Angemeldet?** Leitet LinkedIn auf `/login`, `/uas/…`, `/authwall` oder `/checkpoint/…` um oder zeigt ein Login-Formular, lautet das Ergebnis „nicht angemeldet“. Bei `/checkpoint/challenge` fragt LinkedIn nach einer Sicherheitsprüfung, die der Nutzer selbst erledigt.
- **Gelesen** werden die neuesten 12 Unterhaltungen (Name, Vorschau, Zeit, ungelesen) und der Zähler in LinkedIns Kopfleiste. Die Erweiterung klickt und tippt nichts. Das Ergebnis bleibt im Browser (Signal im `LinkedInStore`) und geht nicht an den Server.
- **Berechtigungen:** `scripting`, Host-Zugriff auf `https://www.linkedin.com/*` und den CRM-Host. Keine Cookies, kein `tabs`.
- **Grenzen:** Der Leser hängt an LinkedIns Seitenaufbau (Klassen `msg-conversation-*`, Fallback über Links auf `/messaging/thread/`). Baut LinkedIn um, meldet das Panel „anders aufgebaut als erwartet“, dann `inbox-reader.js` anpassen. LinkedIns Nutzungsbedingungen untersagen automatisierte Zugriffe. Die Erweiterung liest deshalb nur auf Klick und nie im Hintergrund.
- **Chrome Web Store:** Für eine Installation ohne Entwicklermodus muss die Erweiterung dort veröffentlicht werden. Das Manifest braucht dann die festen CRM-Hosts in `host_permissions` und `content_scripts.matches`.

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
| GET     | `/api/integrations/microsoft`              | Bearer | – (Konfiguration und eigene Verbindung) |
| POST    | `/api/integrations/microsoft/connect`      | Bearer | – (liefert `url` zur Microsoft-Anmeldung, setzt Cookie) |
| GET     | `/api/integrations/microsoft/callback`     | –      | Redirect-Ziel von Microsoft (`code`, `state`) |
| DELETE  | `/api/integrations/microsoft`              | Bearer | – (Verbindung trennen)                 |
| GET     | `/api/calendar/events`                     | Bearer | Query: `from`, `to` (ISO 8601, max. 366 Tage) |
| POST    | `/api/calendar/events`                     | Bearer | `subject`, `start`, `end`, `body`, `location`, `attendees[]`, `isOnlineMeeting` |
| PATCH   | `/api/calendar/events/:id`                 | Bearer | wie POST, alle Felder optional         |
| DELETE  | `/api/calendar/events/:id`                 | Bearer | –                                      |
| GET     | `/api/mail-import`                         | Bearer | – (Modell-Status, letzte Importe)      |
| POST    | `/api/mail-import/jobs`                    | Bearer | `mode` (`test` \| `full`), `maxMessages` (Test), `months` (Voll, leer = alles) |
| POST    | `/api/mail-import/jobs/:id/cancel`         | Bearer | –                                      |
| GET     | `/api/mail-import/jobs/:id/groups`         | Bearer | Query: `status`, `offset`, `limit` (Entscheidungen je Gegenseite) |
| GET     | `/api/crm/summary`                         | Bearer | –                                      |
| GET     | `/api/crm/companies`                       | Bearer | Query: `q`, `relationship`, `offset`, `limit` |
| GET     | `/api/crm/companies/:id`                   | Bearer | – (mit Personen und eigenen Mails)     |
| DELETE  | `/api/crm/companies/:id`                   | Bearer | Query: `ignore=true` (Domains künftig überspringen) |
| GET     | `/api/crm/contacts`                        | Bearer | Query: `q`, `companyId`, `offset`, `limit` |
| GET     | `/api/crm/contacts/:id`                    | Bearer | –                                      |
| DELETE  | `/api/crm/contacts/:id`                    | Bearer | Query: `ignore=true` (nur Privatkontakte) |
| GET     | `/api/tasks`                               | Bearer | Query: `decidedSince` (ISO 8601; ohne: nur offene) |
| POST    | `/api/tasks/:id/approve`                   | Bearer | `draft` (nur bei geändertem Text)      |
| POST    | `/api/tasks/:id/reject`                    | Bearer | –                                      |
| POST    | `/api/tasks/:id/reopen`                    | Bearer | – (Entscheidung zurücknehmen)          |
| POST    | `/api/tasks/reopen`                        | Bearer | – (alle eigenen Entscheidungen zurücknehmen) |
| GET     | `/api/voice`                               | Bearer | – (sind Anrufe eingerichtet?)          |
| POST    | `/api/voice/calls`                         | Bearer | `timeZone` (IANA, vom Gerät); liefert `id` und Begrüßung |
| POST    | `/api/voice/calls/:id/turns`               | Bearer | multipart: `audio` (WAV, 16 Bit PCM) oder JSON: `text`; Antwort als Event-Stream |
| POST    | `/api/voice/calls/:id/finish`              | Bearer | – (auflegen; Event-Stream mit Schritten und Ergebnis) |
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
- **Postgres-Init:** `docker/postgres/init.sh` läuft nur bei leerem Volume. Das Skript legt die Extensions `vector`, `pgcrypto` und `pg_trgm` sowie die Keycloak-Datenbank an. `pg_trgm` holt der Server bei bestehenden Datenbanken beim Start selbst nach.
- **`DB_SYNCHRONIZE=true`** erzeugt die Tabellen aus den Entities. Das ist nur für die Entwicklung gedacht. Vor Produktion auf TypeORM-Migrations umstellen.
- **Keycloak läuft im `start-dev`-Modus** (HTTP, kein Caching der Themes). Für Produktion `start` mit TLS und `KC_HOSTNAME` verwenden.
- **Direct Access Grant** (Passwort über das Backend) ist für ein API-first-Setup pragmatisch, gilt nach OAuth 2.1 aber als Legacy. Sobald ein Web-Frontend dazukommt, empfiehlt sich der Authorization Code Flow mit PKCE über einen eigenen Public Client.

## Lokale Entwicklung ohne Docker für den Server

```bash
docker compose up -d postgres keycloak
cd server && npm install
DB_HOST=localhost DB_PORT=5432 DB_USER=crm DB_PASSWORD=change-me-postgres DB_NAME=crm DB_SYNCHRONIZE=true SEED_DEMO_TASKS=true \
KEYCLOAK_INTERNAL_URL=http://localhost:8080 KEYCLOAK_PUBLIC_URL=http://localhost:8080 \
KEYCLOAK_REALM=crm KEYCLOAK_CLIENT_ID=crm-backend KEYCLOAK_CLIENT_SECRET=change-me-client-secret \
npm run start:dev
```
