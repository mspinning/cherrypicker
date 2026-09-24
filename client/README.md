# Cherrypick Client

Angular-22-Frontend für den Screen „Heute“: Cherrypick schlägt die nächsten Aktionen vor (Mail, Anruf, Angebot, Termin). Du gibst jede per Swipe oder Button frei, verwirfst sie oder bearbeitest den Entwurf vorher.

Anmeldung, Registrierung und Profil laufen gegen das NestJS-Backend in `../server`. Die Vorschläge auf „Heute“ sind noch Mock-Daten in `src/app/features/today/mock-suggestions.ts`.

## Start

```bash
docker compose up -d   # im Repo-Root: Postgres, Keycloak, Server
npm install
npm start              # http://localhost:4200, /api wird an localhost:3000 weitergeleitet
npm run build          # Produktions-Build nach dist/client
```

Der Dev-Server leitet `/api` über `proxy.conf.json` an den Server weiter. In Produktion muss ein Reverse-Proxy `/api` auf denselben Host legen.

## Seiten

| Route       | Zugang       | Inhalt                                                                  |
|-------------|--------------|-------------------------------------------------------------------------|
| `/login`    | nur Gäste    | Anmelden. Three.js-Kirsche, GSAP-Intro, Karte fliegt nach Erfolg raus. |
| `/register` | nur Gäste    | Registrieren, danach automatische Anmeldung.                           |
| `/`         | angemeldet   | Heute (Swipe-Stapel)                                                    |
| `/profile`  | angemeldet   | Profil aus `GET /api/users/me`, Tagesbilanz, Abmelden                   |

Nicht angemeldete Aufrufe landen auf `/login?redirect=…` und kehren nach dem Login dorthin zurück.

## Auth

- `AuthService` ruft `POST /api/auth/login | register | refresh | logout` und `GET /api/users/me` auf.
- Die Tokens liegen in `localStorage` (`cherrypick.session`), damit ein Reload angemeldet bleibt.
- `authInterceptor` setzt den Bearer-Token. Läuft er in weniger als 15 s ab, erneuert er ihn vorher. Nach einem 401 erneuert er einmal und wiederholt die Anfrage. Parallele Anfragen teilen sich einen Refresh.
- Schlägt der Refresh fehl, endet die Sitzung und es geht zurück zu `/login`.

## Layout

| Breite      | Layout                                                                                   |
|-------------|------------------------------------------------------------------------------------------|
| ≥ 1180 px   | Desktop: Queue links, Kartenstapel in der Mitte, Begründung rechts. Toast unten mittig.  |
| < 1180 px   | Mobil: Kartenstapel füllt den Screen. Begründung über „Warum …?“ in der Karte. Toast oben. |

Auf niedrigen Laptop-Bildschirmen (Höhe ≤ 820 px) wird der Desktop vertikal kompakter.

Der Breakpoint steht an zwei Stellen und muss übereinstimmen: `$desktop-min` in `src/styles/_mixins.scss` und `DESKTOP_QUERY` in `src/app/core/viewport.ts`.

## Bedienung

- Karte nach rechts ziehen oder ✓: freigeben. Nach links ziehen oder ✕: verwerfen.
- Pfeiltasten → / ← (Desktop) machen dasselbe. Esc bricht das Bearbeiten ab.
- Nach jeder Entscheidung erscheint 4,5 s lang ein Toast mit „Rückgängig“.

## Struktur

```
src/app/
  app.routes.ts                     Routen + Guards
  core/viewport.ts                  Breakpoint als Signal
  core/auth/                        AuthService, Interceptor, Guards, Modelle
  layout/shell.ts                   Rahmen der angemeldeten Seiten
  layout/app-header.*               Logo + Avatar (→ Profil)
  shared/icon.ts                    Inline-SVG-Icons
  features/auth/
    auth-page.*                     Login / Registrierung (GSAP)
    login-scene.ts                  Three.js-Szene, lazy geladen
    auth-errors.ts                  Fehlertexte, Passwortstärke
  features/profile/profile-page.*   Profil
  features/today/
    today.store.ts                  Zustand (Signals): Stapel, Swipe, Entwürfe, Entscheidungen, Toast
    suggestion.model.ts             Typen
    mock-suggestions.ts             Demo-Daten
    today-page.*                    Seitenlayout (Grid / Mobil)
    components/
      suggestion-stack.ts           Kartenstapel + Swipe-Geste
      suggestion-card.*             Karte (präsentational)
      reason-panel.*                „Warum dieser Vorschlag“
      action-bar.*                  Verwerfen / Bearbeiten / Freigeben
      queue-list.*                  Desktop-Queue
      decision-list.ts              Liste „Heute entschieden“
      done-panel.ts                 „Das war's für heute.“
      undo-toast.*                  Bestätigung + Rückgängig
```

Für die Backend-Anbindung wird `TodayStore` die Vorschläge laden und `decide()`, `undo()` und `saveEdit()` an die API weiterreichen. Die Komponenten selbst müssen dafür nicht geändert werden.
