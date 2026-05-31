# PRD: Owner Scope vollständig entfernen

**Status:** Draft  
**Erstellt:** 2026-05-31  
**Quelle:** Nutzerwunsch: Owner Scope vollständig aus der gesamten App entfernen; kein Übergangsmodell mit `shared:app` als Owner Scope.  
**Abgeleitet von:** `docs/plans/final-owner-scope-removal-umbauplan-2026-05-31.md`  
**Inventar:** `docs/reports/owner-scope-final-removal-inventory-2026-05-31.md`  
**Ralph story batch:** `final-owner-scope-removal.prd.json`

## 1. Executive Summary

### Problem Statement

Pibo ist fachlich auf eine gemeinsame App-Fläche umgestellt, trägt aber noch ein altes Owner-Scope-Modell in Typen, Datenbanken, APIs, CLI/TUI-Flows, Tests und Dokumentation. Das Übergangsmodell nutzt `shared:app` als synthetischen Owner Scope und hält damit eine nicht mehr gewünschte Produktpartition am Leben.

### Proposed Solution

Owner Scope wird vollständig aus dem aktiven Produktmodell entfernt. Authentifizierung bleibt ein Zugangstor, erzeugt aber keinen Produkt-Owner, keinen Principal, keine Workspace-Partition und keinen Speicherwert. Bestehende Daten werden per finaler Cutover-Migration in Schemas ohne Owner-/Principal-Spalten überführt.

### Success Criteria

- **SC-001 Keine aktiven Owner-Scope-Verträge:** Aktive TypeScript-Modelle, APIs, CLI/TUI-Ausgaben, JSON-Payloads und UI-Zustände enthalten keine `ownerScope`-, `owner_scope`-, `shared:app`-, `principalId`- oder `principal_id`-Produktfelder.
- **SC-002 Keine Owner-Scope-Schemas:** Frische SQLite-Schemas erzeugen keine Produktspalten, Tabellen oder Indizes für Owner Scope, Principal-Read-State oder Room Membership.
- **SC-003 Daten erhalten:** Bestehende Sessions, Rooms, Agents, Projects, Workflows, Ralph Jobs, Cron Jobs, Web Annotations und Read-State-relevante Daten bleiben nach der Migration auffindbar und nutzbar.
- **SC-004 Auth bleibt Zugangstor:** Web-Auth erzwingt weiterhin Login, beeinflusst aber keine Sichtbarkeit, Route, Workspace-Auswahl, Job-Kontrolle, Profilregistrierung oder Schreibposition.
- **SC-005 Verifizierter Cutover:** Docker-Validierung, Dev-Deploy/-Browserprüfung, Migrations-Dry-Run, Backup-/Rollback-Plan und Search-Gates sind dokumentiert; Production-Datenmutation bleibt separat zustimmungspflichtig.

## 2. User Experience & Functionality

### User Personas

- **Erlaubter Pibo-Webnutzer:** Meldet sich an und erwartet eine gemeinsame Host-App ohne private Produktbereiche.
- **Operator/Maintainer:** Führt Migrationen, Deployments, Debugging und Rollbacks sicher aus.
- **CLI/TUI-Nutzer:** Arbeitet lokal mit Pibo-Sessions ohne Owner-Auswahl oder Account-Impersonation.
- **Automationsnutzer:** Nutzt Ralph, Cron und Workflows als app-weite Automationsflächen.
- **Ralph-Implementierungsagent:** Benötigt sequenzierte, prüfbare Stories mit klaren Akzeptanzkriterien.

### Product Rule

Es gibt genau einen Produktdatenraum pro Pibo-Host: die App. Login beantwortet nur die Frage „darf diese Person in die App?“. Nach Login darf keine Produktfunktion nach Auth-User, Principal, Owner Scope oder `shared:app` partitionieren.

### User Stories and Acceptance Criteria

#### Story 1: Auth ohne Produkt-Ownership

As an erlaubter Pibo-Webnutzer, I want Login nur als Zugangstor so that mein Auth-Account keine separate Produktfläche erzeugt.

Acceptance criteria:

- Unauthentifizierte Web-Anfragen bleiben dort `401`, wo Auth nötig ist.
- Authentifizierte Handler erhalten keinen account-derived `ownerScope` als Produktzustand.
- Runtime-Kontext, Session-Kontext und Debug-Ausgaben stellen Auth-Identität nicht als Produkt-Owner dar.
- Zwei erlaubte Auth-Identitäten landen im selben App-Kontext.

#### Story 2: App-globale Sessions und Rooms

As an erlaubter Pibo-Webnutzer, I want alle Sessions und Rooms in einer gemeinsamen Historie so that alte und neue Arbeit nicht durch Owner-Werte versteckt wird.

Acceptance criteria:

- Session- und Room-APIs filtern nicht nach Owner oder Principal.
- Direct open, sidebar navigation, bootstrap, send, fork/clone, archive/restore/delete arbeiten per Resource-ID und Zustand.
- Room-Membership und Principal-Stats sind keine Zugriffskontrolle mehr.
- UI-Wording verwendet shared/default/app wording, nicht personal/owner wording.

#### Story 3: App-globale Produktressourcen

As an erlaubter Pibo-Webnutzer, I want Agents, Projects, Workflows, Annotations und Settings gemeinsam zu sehen so that der Host eine konsistente Konfiguration hat.

Acceptance criteria:

- Custom Agents, Projects, Workflow UI persistence und Web Annotations haben keine Owner-Filter oder Owner-Schreibwerte.
- Profilregistrierung für Custom Agents ist app-global.
- Historische Duplikate werden deterministisch zusammengeführt oder umbenannt.
- API-/UI-Payloads enthalten keine Owner-Felder.

#### Story 4: App-globale Automation

As an Operator, I want Ralph, Cron und Workflow Runs ohne Owner Scope so that Automation sichtbar und steuerbar bleibt, unabhängig vom Login-Account.

Acceptance criteria:

- Ralph/Cron Jobs, Runs, Facts, Targets, CLI, Chat API und Chat UI enthalten keine Owner-Felder.
- `personal.principalId` wird durch ein neutrales Ziel wie `default-chat` ersetzt.
- Workflow Runs im package-level Store haben kein `owner_scope` und keinen `ownerScope`-Filter.
- CLI-Help und JSON-Ausgaben enthalten kein `--owner-scope` und kein `ownerScope`.

#### Story 5: CLI/TUI ohne Owner-Auswahl

As a CLI/TUI-Nutzer, I want direkt in der App-Session-Ansicht zu arbeiten so that ich keinen künstlichen Owner auswählen oder reparieren muss.

Acceptance criteria:

- `CliOwnerSummary`, `getActiveOwner`, `setActiveOwner`, `listOwners`, `/owner`, Owner Picker und Owner-Mismatch-Fehler sind entfernt.
- Recovery bleibt, falls nötig, als Recovery-Modus oder Source bezeichnet, nicht als Owner.
- PTY-Validierung beweist, dass `pibo tui:sessions` ohne Owner-Picker Sessions öffnen/erstellen/senden kann.

#### Story 6: Sichere finale Datenmigration

As an Operator, I want eine überprüfbare Cutover-Migration so that alte Owner-/Principal-Daten ohne Datenverlust in finale Schemas überführt werden.

Acceptance criteria:

- Migration hat inspect, dry-run, apply, Backup-Prüfung, Konfliktbericht und Post-Checks.
- SQLite-Tabellen werden kontrolliert ohne Owner-/Principal-Spalten neu aufgebaut.
- Konflikte bei Default Rooms, Read-State, Navigation, Custom-Agent-Profilnamen und Automation Targets werden deterministisch gelöst.
- Production-Apply bleibt separat zustimmungspflichtig.

#### Story 7: Dokumentation und Gates verhindern Rückfall

As a Maintainer, I want Docs, Tests und Search-Gates auf das finale App-Modell auszurichten so that künftige Agenten Owner Scope nicht wieder einführen.

Acceptance criteria:

- Current docs beschreiben das finale App-Space-Modell.
- Historische Owner-Scope-Dokumente liegen in `docs/legacy/` oder sind klar als historische Evidenz markiert.
- Search-Gates für aktive Source und current docs schlagen bei Owner-Scope-/Principal-Produktbegriffen fehl.
- Tests verwenden `user:*` und `shared:app` nur in gezielten Migration-Fixtures, nicht als aktuelles Produktmodell.

### Non-Goals

- Keine Teams, Rollen, Berechtigungen oder Multi-Tenant-Isolation.
- Keine Entfernung von Better-Auth-Tabellen oder Login-Mechanik.
- Kein Rewriting der Git-Historie.
- Keine Production-Datenmutation ohne separate explizite Zustimmung.
- Keine allgemeine UI-Neugestaltung jenseits der Entfernung von Owner-/Personal-Wording.
- Keine dauerhafte Runtime-Kompatibilität für alte Owner-Schemas nach dem finalen Cutover.

## 3. AI System Requirements

### Tool Requirements

Der Ralph Loop braucht:

- `rg`/Code Search für Owner-/Principal-Gates.
- TypeScript-Build, Typecheck und Node-Testläufe.
- SQLite-Inspection und Fixture-Datenbanken.
- Pibo CLI Discovery für Data, Debug, Ralph, Cron, Gateway und TUI.
- Docker Worker mit isoliertem Worktree und sandboxed `PIBO_HOME`.
- Browser/CDP-Validierung für Chat Web und PTY-Validierung für TUI.

### Evaluation Strategy

Ralph darf Stories nur als bestanden markieren, wenn konkrete Evidenz vorliegt: Kommandos, Testergebnisse, API-/Browser-/PTY-Pfade, betroffene Dateien und bekannte Einschränkungen. Für user-facing Web-/CLI-/TUI-Flächen müssen Real-Path-Prüfungen ergänzt werden, nicht nur Unit Tests.

Globaler Abschluss erfordert:

- `npm run typecheck`, `npm run build`, `npm test` erfolgreich.
- Migration-Fixtures bestehen inspect/dry-run/apply/idempotency/rollback checks.
- Search-Gates zeigen keine aktiven Owner-Scope-Produktbegriffe außerhalb gezielter Migration-/Legacy-Ausnahmen.
- Dev-Deploy und Browser/API-Validierung sind dokumentiert.
- Production-Runbook ist bereit, aber Production-Apply wurde nicht autonom ausgeführt.

## 4. Technical Specifications

### Architecture Overview

Target flow:

1. Web Auth validiert Zugriff.
2. Product handlers erhalten den gemeinsamen App-Kontext, aber keinen Produkt-Owner.
3. Stores lesen/schreiben per Ressourcen-ID, App-Defaults und fachlichem Zustand.
4. Runtime, Workflows, Ralph, Cron und CLI/TUI leiten Workspace, Sichtbarkeit und Kontrolle nicht aus Auth-Usern ab.
5. Cutover-Migration baut alte Tabellen in finale Schemas ohne Owner-/Principal-Spalten um.
6. Nach Cutover bleibt keine dauerhafte Owner-Scope-Kompatibilität in aktiver Runtime.

### Integration Points

Betroffene Flächen:

- `src/web/auth.ts`, `src/web/types.ts`, `src/shared-app.ts`, Runtime-Kontext.
- `src/sessions`, `src/data`, Chat rooms/navigation/read-state/session APIs.
- Chat UI bootstrap, API types und copy.
- Custom Agent Store und Dynamic Profile Registration.
- Projects und Workflow UI persistence.
- Ralph store/service/CLI/Chat API/Chat UI.
- Cron store/service/CLI/Chat API/Chat UI.
- `packages/workflows` types/store/runtime/inspection.
- Web Annotations API/store/tools/CDP/attachments.
- CLI/TUI session source and Ink UI.
- Debug/data migration commands.
- Tests, current docs, glossary, skills/tool guides.

### Security & Privacy

- Login bleibt Pflicht für Web-Zugriff.
- Gemeinsame Produktdaten sind gewolltes Verhalten, kein Auth-Leak.
- Auth User IDs dürfen nicht zu Produkt-Sichtbarkeit, Workspace, Jobs, Profilen oder Read-State werden.
- Migrationsberichte dürfen keine Tokens, Provider Secrets oder unnötigen personenbezogenen Details ausgeben.
- Debug darf alte Owner-Werte nur als Legacy-Evidenz anzeigen.

### Data Migration Requirements

Zu migrieren sind mindestens:

- `pibo.sqlite`: rooms, navigation, read-state/principal stats, room memberships.
- `pibo-sessions.sqlite`: Pibo sessions and owner columns.
- `chat-agents.sqlite`: custom agents.
- `web-projects.sqlite`: projects and workflow UI persistence.
- `web-annotations.sqlite`: annotations and bindings.
- `pibo-ralph.sqlite`: Ralph jobs/runs/facts/resources/targets.
- `pibo-cron.sqlite`: Cron jobs/runs/targets.
- `pibo-workflows.sqlite`: workflow runs and package store schema.

Conflict rules:

- Preserve stable IDs where possible.
- Merge duplicate read-state by max cursor/newest timestamp.
- Choose one app default room; preserve other rooms with deterministic names or archived state.
- Deterministically rename colliding global Custom Agent profile names.
- Rewrite personal automation targets to `default-chat`.
- Do not mutate live Production without explicit approval and backup.

## 5. Risks & Roadmap

### Phased Rollout

1. Baseline inventory, PRD/JSON, progress tracking and search gates.
2. Core app/auth/session model cleanup.
3. Chat rooms/navigation/read-state and schemas.
4. Product feature stores: Custom Agents, Projects, Workflow UI, Web Annotations.
5. Automation: Ralph, Cron, Workflows package.
6. CLI/TUI owner model removal.
7. Final migration tooling and fixture validation.
8. Docs/tests cleanup and strict gates.
9. Docker + Dev validation.
10. Production runbook and separately approved Production migration.

### Technical Risks

| Risk | Mitigation |
|---|---|
| Datenverlust bei Schema-Rebuild | Verified backups, transactional rebuilds, row counts, `PRAGMA quick_check`, rollback docs. |
| Hidden runtime compatibility bleibt bestehen | Strict search gates and code review rule: no active owner compatibility after cutover. |
| Duplicate global names | Deterministic rename/merge reports before dropping columns. |
| Production deploy before migration | Explicit deployment order and Production approval gate. |
| Ralph scope too large | Split into small stories, commit coherent batches, stop on failing gates. |
| Auth identity becomes new owner | Security acceptance criteria and tests for two auth identities using same app context. |
| UI/API regressions | Browser, API and PTY real-path validation in addition to unit tests. |

### Open Questions

- Soll der finale Cutover-Migrator dauerhaft als operator-only Legacy-Tool im Code bleiben, oder nach Production-Migration in einem Folge-PR gelöscht werden? Der Umbauplan bevorzugt Löschen nach Cutover.
- Welche Production-Migrationszeit ist akzeptabel, wenn aktive Sessions laufen? Production-Apply bleibt separat zustimmungspflichtig.
- Sollen historische docs mit Owner Scope vollständig nach `docs/legacy/` verschoben oder in current docs umgeschrieben werden?
