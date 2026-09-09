---
type: "Plan"
title: "Persistenter Session-Präfix und erklärbare Cache-Einbrüche"
description: "Verbindlicher Umbauplan für unveränderliche Session-Präfixe in allen Runtimes, sichere Wiederaufnahme und kostengünstige Cache-Diagnostik."
tags: ["runtime", "session", "prompt-caching", "persistence", "telemetry"]
status: "draft"
authority: "directive"
generated:
  by: "openai/codex"
  at: "2026-09-08T13:20:00Z"
planning_baseline: "d631e8f0e88b9e25024e706d79dec62d864f7456"
sources:
  - id: "owner-requirements"
    resource: "scope:Pibo Session ps_ae5e1a0c-0e10-461a-b9dc-6c5f9b09ddc6, owner requirements on 2026-09-08"
    relation: "Priorität, Session-Unveränderlichkeit, vollständiger Präfix, alle Runtimes, geringer Overhead und Agentenübergabe"
  - id: "telemetry"
    resource: "/specs/data/telemetry.md"
    relation: "Bestehende Telemetriegrenzen und Datenminimierung"
  - id: "capture-plan"
    resource: "/plans/telemetry-capture-archive-isolation.md"
    relation: "Abgrenzung notwendiger Betriebsdaten von optionaler Diagnoseaufzeichnung"
  - id: "runtime-contract"
    resource: "/specs/runtime/adapter-contract.md"
    relation: "Bestehender gemeinsamer Adaptervertrag"
  - id: "binding-contract"
    resource: "/specs/runtime/session-binding-and-history-handoff.md"
    relation: "Revisionierte Bindungen und begrenzter portabler History-Handoff"
  - id: "codex-contract"
    resource: "/specs/runtime/codex-native-adapter.md"
    relation: "Native Thread-/Ressourcengrenzen und gegenwärtige Beobachtbarkeit"
  - id: "openai-caching"
    resource: "https://developers.openai.com/api/docs/guides/prompt-caching"
    retrieved_at: "2026-09-08"
    relation: "Providerseitige Voraussetzungen; keine Garantie durch Pibo allein"
  - id: "openai-responses"
    resource: "https://developers.openai.com/api/reference/cli/resources/responses/methods/create"
    retrieved_at: "2026-09-08"
    relation: "Öffentlich dokumentierte Cache-Diagnostik; Unterstützung des tatsächlichen Backends separat nachweisen"
---

# Kontext und Ziel

Caching ist eine wirtschaftliche Kernanforderung von Pibo. Ein Gateway- oder Runtime-Neustart darf einen bestehenden Modell-Prompt nicht aus aktuellen Dateien neu erzeugen und dadurch den bereits aufgebauten Präfix verändern. Dieser Plan ist die vollständige Arbeitsübergabe für die Implementierung; er beschreibt beabsichtigtes, noch nicht implementiertes Verhalten.

Der Eigentümer verlangt: Neue Sessions verwenden die aktuellen Kontextdateien, Skills und Tools. Sobald eine Session Modellhistorie erzeugt, wird ihr vollständiger aufgelöster Präfix dauerhaft eingefroren. Bei Wiederaufnahme wird dieser Stand geladen; die native Runtime lädt weiterhin ihre Gesprächshistorie. Pibo behandelt den Präfix als zusammenhängendes Paket und führt im normalen Betrieb keine teure Buchhaltung über einzelne Quelldateien oder Prompt-Bestandteile.

Auslöser war ein untersuchter Modellaufruf mit 154.255 Eingabetokens, davon 3.712 gecacht und 150.543 ungecacht. Der folgende Aufruf meldete 153.984 gecachte von 155.937 Eingabetokens. Die bisherige Untersuchung fand dieselben Zahlen in nativer Usage und Pibo-Ereignissen. Das belegt einen gemeldeten Cache-Einbruch, aber ohne damaligen Request-Präfix lässt sich dessen Ursache nicht abschließend einem Neustart zuschreiben. Der Abstand zum letzten erfolgreichen Aufruf betrug ungefähr fünf Minuten. Diese Beobachtung begründet die Anforderungen; sie ist kein Beweis einer bestimmten Fehlerursache.

Die überprüfbare Produktgarantie lautet: **Innerhalb einer Kontext-Epoche verändert Pibo einschließlich seiner Runtime-Integration den bereits erzeugten modellseitigen Präfix nicht; nur neue Gesprächsinhalte werden angehängt.** Ein identischer clientseitiger Präfix garantiert keinen Cache-Treffer beim Provider. Der Plan trennt deshalb nachgewiesene lokale Änderungen, vom Provider gemeldete Ursachen und weiterhin unbekannte Ursachen. Eine garantierte Cache-Lebensdauer oder Trefferquote wird nicht versprochen.

# Umfang und feste Entscheidungen

| Gegenstand | Entscheidung |
|---|---|
| Speicherung | Ein unveränderliches, vollständiges Präfix-Paket pro Präfix-Version; keine Zerlegung nach Kontextquelle als Voraussetzung. |
| Gesprächshistorie | Bleibt bei Pi, Codex oder dem jeweiligen nativen Harness; Pibo speichert Bindung und Wiederaufnahmezustand, keine zweite vollständige Historie. |
| Format | Adapterkodiertes Paket mit Text, Rollen, geordneten Tool-Definitionen und allen weiteren präfixwirksamen Eingaben. Ein einfacher zusammengeklebter String reicht für strukturierte APIs nicht. |
| Wiederaufnahme | Lädt Paket und native Historie. Kein erneutes Einlesen aktueller Basisdateien, kein Rendering mit neuer Uhrzeit oder neuem Runtime-Pfad. |
| Laufende Änderungen | Neue Informationen kommen als neue Nachrichten an das Ende. Eine notwendige Änderung am bisherigen Präfix eröffnet eine ausdrücklich protokollierte neue Epoche. |
| Compaction | Beginnt eine neue Historien-/Vergleichsepoche. Standardmäßig wird dasselbe eingefrorene Basispaket referenziert; Compaction allein ist kein Anlass zum Neuladen aller Dateien. Ein gewünschter Basis-Refresh ist eine separate, sichtbare Entscheidung. |
| Modell-/Runtime-Wechsel | Sichtbare Kompatibilitätsprüfung und gegebenenfalls neue Epoche. Kein Gleichheitsversprechen über inkompatible Modelle oder Harness-Formate hinweg. |
| Cache-Key | Stabil für dieselbe native Session und Provider-Konfiguration; nicht aus Runtime-Generation, Prozess-ID oder Startzeit ableiten. Semantik des tatsächlichen Backends beachten. |
| Diagnostik | Kleine Metadaten pro Modellaufruf und Lebenszyklusereignis; keine vollständigen Prompts oder Quelldatei-Hashes bei jedem Turn. |
| Alle Runtimes | Keine Fertigmeldung, solange eine produktive Runtime den Wiederaufnahmevertrag nicht nachweislich erfüllt. Fehlende native Unterstützung ist eine explizite Implementierungsabhängigkeit. |

Nicht Teil dieses Umbaus sind eine eigene Verwaltung des Provider-KV-Caches, künstliche Keep-alive-Modellaufrufe, ein Ersatz nativer Compaction oder eine allgemeine Neuentwicklung der Telemetrie. Ebenso wenig darf der Agent durch einen manuellen Gateway-Neustart auf dem Controller die Untersuchung reproduzieren.

# Verbindliche Anforderungen

Die IDs gehören zu diesem Plan. Bei Umsetzung werden sie mit den tatsächlichen Code- und Testbelegen in die jeweils zuständigen aktuellen Spezifikationen überführt.

| ID | Verpflichtung | Abnahme |
|---|---|---|
| PIBO-PREFIX-001 | Den vollständig aufgelösten Präfix vor dem ersten Provider-Dispatch dauerhaft versiegeln; nur versiegelte Zustände können geschützte Modellaufrufe starten. | Crash- und Nebenläufigkeitstests T02/T03. |
| PIBO-PREFIX-002 | Bei Wiederaufnahme dieselben präfixwirksamen Inhalte, Reihenfolgen, Rollen, Tool-Schemas und Einstellungen wiederherstellen. | Aufgezeichneter tatsächlicher Request vor/nach Neustart: T01/T04. |
| PIBO-PREFIX-003 | Während einer Epoche bleibt die bisherige Modellhistorie unverändert und wird ausschließlich erweitert; Ausnahmen sind explizite Epochenwechsel. | T01/T05/T06, einschließlich Tool- und Reasoning-Inhalten. |
| PIBO-PREFIX-004 | Alle registrierten produktiven Runtime-Adapter erfüllen denselben Vertrag; unbekannte Fähigkeiten gelten nicht als nachgewiesen. | Vollständige Adaptermatrix in Phase 0 und T04. |
| PIBO-PREFIX-005 | Fehlende, beschädigte oder inkompatible Pakete dürfen keinen stillen Neuaufbau aus aktuellen Quellen auslösen. | T02/T07 und sichtbare Wiederherstellungsoption. |
| PIBO-PREFIX-006 | Native Session-/Thread-Bindung, Cache-Key-Semantik und benötigte Ressourcen über Neustarts erhalten. | T04/T08, einschließlich Wechsel von Runtime-Generation und Transport. |
| PIBO-PREFIX-007 | Compaction, Modellwechsel, Fork, Import, Löschung und Upgrade besitzen explizite, getestete Regeln. | T05/T06/T07/T09. |
| PIBO-CACHE-001 | Usage und Cache-Werte dem verursachenden Modellaufruf zuordnen; Toolausführung und Endturn dürfen keine künstlichen zusätzlichen Verbrauchswerte erzeugen. | T10 mit Originalzahlen und synthetischen Streaming-Fällen. |
| PIBO-CACHE-002 | Vergleichbare Cache-Einbrüche im Debug-Modus und CLI erkennbar machen; Ursache und Beweisstärke getrennt anzeigen. | T11/T12. |
| PIBO-CACHE-003 | Gleicher Paket-Hash allein beweist weder unveränderte Historie noch einen Provider-Cache-Treffer. Unbekanntes ausdrücklich unbekannt lassen. | T04/T11. |
| PIBO-CACHE-004 | Normaler Turn benötigt keine zusätzlichen vollständigen Prompt-/Historienkopien, Quelldatei-Scans oder synchronen Diagnose-Schreibvorgänge. | Last- und Profilnachweis T13. |
| PIBO-CACHE-005 | Keine Tokens, Authentifizierungsdaten oder vollständigen Präfixe in standardmäßigen Telemetrieereignissen. | T14; Präfix-Paket bleibt geschützter Session-Betriebszustand. |

# Architektur und Datenvertrag

## Zuständigkeiten

Der runtime-neutrale Session-Layer besitzt die unveränderliche Paketreferenz, die Kontext-Epoche, die atomare Veröffentlichung und den Lebenszyklus. Der Adapter besitzt die exakte Kodierung und Wiederherstellung seines präfixwirksamen Zustands sowie die Bindung an den nativen Session-/Thread-Speicher. Die native Runtime besitzt weiterhin Historie, Tool-Roundtrips und Compaction. Der Provider besitzt seinen Cache und gegebenenfalls nicht einsehbare interne Prompt-Verarbeitung.

Die Grenze muss am letzten vom jeweiligen Adapter kontrollierten Punkt vor dem Modellaufruf geprüft werden. Ein Snapshot vor späteren System-Prompt-Erweiterungen oder Tool-Hooks erfüllt den Vertrag nicht. Nachgelagerte Hooks dürfen während derselben Epoche keine eingefrorenen Inhalte neu berechnen. Notwendige dynamische Kontextinformationen werden als neue Nachrichten eingefügt oder lösen einen sichtbaren Epochenwechsel aus.

Bei einer nativen Runtime mit verborgenem Request-Aufbau reicht es nicht, Pibo-Dateien zu kopieren. Der Implementierer muss den nativen Wiederaufnahmevertrag anhand der tatsächlich verwendeten Version und Schnittstelle nachweisen. Fehlt eine Möglichkeit, veränderte interne Systemanweisungen, Tool-Schemas oder Ressourcen auszuschließen, ist zuerst eine unterstützte native Erweiterung erforderlich. Keine doppelte Einspeisung eines gespeicherten Systemprompts in eine Runtime, die denselben bereits selbst einfügt.

## Vorgeschlagenes persistentes Modell

Die folgenden Namen sind neue Entwurfsnamen, keine Behauptung über vorhandene Schnittstellen. Sie sollen in bestehende Session-Persistenz integriert werden, ohne einen parallelen allgemeinen Speicher einzuführen.

| Objekt | Erforderlicher Inhalt |
|---|---|
| `SessionPrefixBinding` | Pibo-Session-ID, aktive Kontext-Epoche, Paketreferenz und Digest, Adapter-/Codec-Version, native Session-/Thread-Referenz, Schutzstatus, Erstellungs- und Übergangsgrund. |
| `PrefixCapsule` | Unveränderliches opakes Adapter-Payload: kompletter aufgelöster statischer Präfix einschließlich geordneter strukturierter Inhalte; notwendige native Start-/Resume-Einstellungen und stabile Ressourcenreferenzen. |
| `ContextEpoch` | Vorgänger, Grund, Modell/Provider-Kompatibilität, native Historienrevision oder unterstützter Head-Nachweis, Präfixreferenz und atomarer Status. |
| `CacheObservation` | Modellaufruf-ID, Epoche, Paket-Digest, Nachweisumfang, pseudonymisierter effektiver Cache-Key soweit sichtbar, kompakter Konfigurationsfingerprint, Usage, Vergleichsaufruf und Diagnose. |

Zeitstempel für Verwaltung stehen außerhalb des an das Modell gereichten Payloads. Die Kodierung erhält modellrelevante Bytes und Reihenfolgen; eine kanonische JSON-Neusortierung des gesendeten Prompts ist kein zulässiger Ersatz für exakte Wiederherstellung. Ein Digest prüft Integrität des gespeicherten Pakets, nicht rückwirkend die Gleichheit unbekannter historischer Requests.

Persistenz erfolgt einmal pro neuem Paket. Geeignet ist ein unveränderliches, inhaltadressiertes Artefakt plus kleine transaktionale Session-Referenz im vorhandenen Datenspeicher. Bestehende atomare Schreibmechanismen wiederverwenden. Gleicher Paketinhalt kann innerhalb derselben berechtigten Speichergrenze referenziert werden; eine globale mandantenübergreifende Deduplizierung ist nicht erforderlich.

Skills oder andere eingefrorene Ressourcen, die später tatsächlich gelesen werden, müssen unter dauerhaft stabilen Referenzen verfügbar sein. Nur einen alten Pfad auf eine zwischenzeitlich geänderte Datei zu speichern genügt nicht. Vorhandene versionierte Ressourcenpakete bevorzugen; falls nötig einmalig ein zusammenhängendes Ressourcenartefakt neben dem Präfix speichern. Es wird kein vollständiger Workspace-Snapshot verlangt. Benutzerdateien im Workspace bleiben regulär veränderlich; deren spätere Leseergebnisse sind neue Historie.

Tool-Schema und ausführbare Implementierung dürfen nicht unbemerkt auseinanderlaufen. Kompatible Implementierungsupdates sind möglich; semantisch inkompatible Änderungen brauchen eine überprüfte Versionsbindung oder einen sichtbaren Übergang. Aktuelle Berechtigungen und widerrufene Zugriffe werden weiterhin zur Ausführungszeit geprüft. Credentials werden niemals im Präfix-Paket konserviert.

## Adaptervertrag und Zustände

Ein kleiner Adaptervertrag soll konzeptionell `capture`, `restore`, `validateCompatibility` und einen kompakten Nachweis für den tatsächlich verwendeten Zustand bereitstellen. Vorhandene Runtime-Abstraktionen erweitern; keine universelle Nachbildung aller nativen Request-Protokolle. Pro Adapter dokumentieren: eigener bzw. verborgener Prompt-Anteil, Capture-Punkt, Resume-Punkt, Historieneigentümer, Cache-Key-Zugriff und verbleibende native Abhängigkeiten.

Zustandsfolge: `uninitialized → preparing → sealed → active`. Wiederaufnahme geht von `sealed` nach `active` ohne `preparing`. Fehler führen in einen sichtbaren Zustand `recovery-required`; ausdrücklich als Altbestand gekennzeichnete Sessions können vor Migration `legacy-unverified` sein. `legacy-unverified` ist keine geschützte Session und darf in UI, CLI oder Tests nicht als erfolgreiche Umsetzung zählen.

Vor dem ersten Dispatch müssen Paket und Session-Bindung dauerhaft bestätigt sein. Ein Session-Lock bzw. Compare-and-Swap verhindert zwei gleichzeitige Erstaufbauten. Bei Dateien zuerst temporär schreiben, Integrität prüfen und atomar veröffentlichen, dann die Referenz transaktional festlegen. Die konkrete Reihenfolge muss zu vorhandener Persistenz passen; Fault-Injection muss jeden Zwischenzustand abdecken. Nicht referenzierte Artefakte dürfen später begrenzt bereinigt werden. Nach einem Crash darf keine bestätigte Session auf ein halbfertiges Paket verweisen.

Native Historie und Pibo-Bindung benötigen einen wiederherstellbaren Übergangsmarker, falls sie nicht in derselben Transaktion liegen. Nicht versuchen, fremde native Speicher durch eine Pibo-Transaktion scheinbar atomar zu machen. Bei unklarer Historienrevision wird erst rekonstruiert bzw. ein Konflikt gemeldet, bevor der nächste geschützte Provider-Dispatch erfolgt.

# Lebenszyklusregeln

| Auslöser | Gefordertes Verhalten |
|---|---|
| Neue Session ohne Modellhistorie | Aktuelle Quellen einmal auflösen, nativen Zustand anlegen, endgültiges Paket versiegeln, danach erster Dispatch. |
| Gateway-/Runtime-Neustart | Native Bindung, vorhandenes Paket und Ressourcen wiederherstellen. Kein neuer Präfix allein wegen neuer Runtime-Generation. |
| Datum, Zeitzone, CWD oder temporäre Pfade ändern sich | Bereits enthaltene Werte bleiben unverändert. Neue relevante Information wird angehängt. Inkompatibles Arbeitsverzeichnis erfordert sichtbaren Übergang, keine stille Ersetzung. |
| Kontextdatei, Skill oder Tool-Katalog ändert sich | Bestehendes Paket bleibt gültig; neue Sessions sehen die Änderung. Ein bewusst angeforderter Refresh erzeugt eine neue Epoche mit angekündigter Cache-Auswirkung. |
| Automatische oder manuelle Compaction | Native Compaction ausführen, neue Historienepoche atomar zuordnen, Vergleichsbasis zurücksetzen. Bestehendes Basispaket weiterverwenden, sofern kein zusätzlicher Refresh erforderlich und ausgewiesen ist. |
| Modell-/Provider-/Runtime-Wechsel | Kompatibilität vor Dispatch prüfen. Übergangsgrund protokollieren; neues Paket nur wenn erforderlich. Modellwechsel auch bei gleichem Paket als Cache-Vergleichsgrenze behandeln. |
| Fork/Clone | Unveränderliches Paket nach Berechtigungsprüfung referenzieren und native Historie über unterstützten Fork übernehmen. Neue Pibo-/native Identität explizit führen. Neue Identitätsinformationen gegebenenfalls anhängen; kein Umschreiben des übernommenen Präfixes. |
| Import/Backup/Restore | Native Historie, Bindung, Paket und Ressourcen gemeinsam exportier-/wiederherstellbar machen. Nur-Historien-Import als unvollständig kennzeichnen; niemals automatisch als geschützt ausgeben. |
| Löschen/Retention | Paket nur löschen, wenn keine Session-/Fork-/Backup-Referenz es benötigt. Diagnose-Retention darf notwendige Betriebsdaten nicht entfernen. |
| Versionsupgrade | Codec- und native Resume-Kompatibilität vor Aktivierung testen. Paket nur dann migrieren, wenn modellseitige Gleichheit nachgewiesen bleibt; ansonsten expliziter Übergang. |
| Defekter Speicher oder fehlende Ressourcen | Betroffene Wiederaufnahme mit präzisem Fehler stoppen. Unterstützte Reparatur aus Backup oder ausdrücklich gewählte neue Epoche anbieten. Kein stiller aktueller Neuaufbau. |

Für Alt-Sessions zuerst prüfen, ob ihr tatsächlich verwendeter Präfix aus nativen Daten oder einer noch laufenden Runtime exakt gewonnen werden kann. Dann ohne erneuten Dispatch versiegeln und die Herkunft des Nachweises vermerken. Ist das nicht möglich, darf ein heute neu gebauter Präfix nicht als historischer Originalstand gespeichert werden. Solche Sessions behalten im gestuften Rollout den sichtbaren Status `legacy-unverified`; der Übergang erfolgt an einem ausdrücklich gewählten Neuaufbau oder einer geeigneten natürlichen Kontextgrenze. Für vollständig aktivierten Schutz muss jede Session entweder nachweislich übernommen oder ausdrücklich neu basiert sein. Es gibt keine rückwirkende Gleichheitsgarantie für nicht aufgezeichnete Requests.

# Cache-Diagnostik ohne teuren Dauerbetrieb

## Erfassung und Vergleiche

Die vorhandene Modellaufruf-/Usage-Pipeline wird erweitert. Ein Datensatz wird pro abgeschlossenem oder abgebrochenem Modellaufruf finalisiert; Streaming-Zwischenstände, mehrere Toolcalls desselben Aufrufs und die Endturn-Darstellung dürfen die Kosten nicht vervielfachen. Fehlende Usage ist `unknown`, niemals automatisch null gecacht. Adapter normalisieren inklusive/exklusive Inputzählung sowie Cache-Lese- und Schreibmengen ausdrücklich und testen kumulative Updates.

Neben der bestehenden Usage werden nur kleine Felder gespeichert: Request-Korrelation, vorheriger vergleichbarer Aufruf, Epoche, Paket-Digest, sichtbare Konfigurations-/Key-Fingerprints, Zeit seit dem letzten vergleichbaren Aufruf, Runtime-Neustartmarker und Diagnose mit Evidenzgrad. Bestehende Felder referenzieren statt duplizieren. Effektive API-Keys und rohe Authentifizierungsdaten bleiben ausgeschlossen; auch ein Provider-Cache-Key wird standardmäßig nur pseudonymisiert abgelegt.

Paket-Digest und Kompatibilitätsfingerprint werden bei Versiegelung/Wiederaufnahme berechnet und im Speicher wiederverwendet. Eine zusätzliche komplette Serialisierung oder Hashrunde über 100.000 Tokens pro Turn ist verboten. Native unveränderliche Historienrevisionen oder beim ohnehin stattfindenden Schreiben berechnete Änderungsnachweise bevorzugen. Wo native Requests verborgen bleiben, den Nachweisumfang offenlegen; ein statischer Hash ersetzt keinen Beweis über spätere Harness-Manipulationen.

Diagnosen unterscheiden mindestens `local-prefix-changed`, `cache-key-changed`, `configuration-changed`, `expected-epoch-change`, `provider-reported`, `unchanged-observed-input/unknown` und `insufficient-evidence`. Mehrere Fakten dürfen gleichzeitig vorliegen. Ein Gateway-Neustart ist ein korreliertes Ereignis, keine automatisch bewiesene Ursache. Längere Inaktivität ist ein Hinweis; ohne Providerbeleg lautet die Ursache nicht „TTL abgelaufen“.

Provider-Diagnostik kann optional ergänzen, sofern das tatsächlich benutzte Backend diese Felder unterstützt. Die öffentliche Responses-API-Dokumentation beweist keine Unterstützung im ChatGPT-/Codex-Backend. Capability-Prüfung und Tests sind Pflicht; keine experimentellen Parameter ungeprüft an produktive OAuth-Endpunkte senden. Cache-Retention-Optionen nur bei belegter Unterstützung und unter Berücksichtigung ihrer Kosten konfigurieren. Keine bezahlten Keep-alive-Aufrufe als Standardmaßnahme.

## Warnung und Oberfläche

Eine deterministische erste Warnregel gilt für vergleichbare Aufrufe innerhalb derselben Epoche: vorheriger erfolgreicher Aufruf mit mindestens 80 % Cache-Leseanteil, aktueller Aufruf mit mindestens 16.384 Eingabetokens und höchstens 10 % Cache-Leseanteil, wobei der bisherige Kontext nachweislich weiterverwendet werden sollte. Die Regel wird benannt und versioniert; Grenzwerte sind zentrale Konstanten und müssen getestet werden. Bei unzureichendem Historiennachweis lautet die Anzeige „möglicher Cache-Einbruch“, nicht „Präfix nachweislich unverändert“.

Der erste Aufruf einer Session, ein expliziter Epochenwechsel und ein erstmalig großer Prompt gelten als erwarteter Aufbau. Ein anderer hoher ungecachter Anteil bleibt als Usage sichtbar, auch wenn diese spezielle Warnregel nicht greift. Teilschäden können über die Vergleichsansicht untersucht werden; die erste Ausbaustufe braucht keine komplexe Anomalieplattform.

Im bestehenden Debug-Modus zeigt der zugehörige Modellaufruf eine kompakte Warnung, zum Beispiel: „Cache stark eingebrochen: 150.543 / 154.255 Eingabetokens ungecacht.“ Aufklappen zeigt vorherigen Cache-Anteil, Zeitabstand, Epoche, Neustartmarker, belegte Unterschiede und ausdrücklich unbekannte Ursachen. Toolcall und Endturn verweisen auf ihren jeweiligen Modellaufruf. Bei mehreren Tools desselben Modellaufrufs wird kein weiterer Kostenposten erzeugt. Außerhalb des Debug-Modus entsteht keine zusätzliche Warnflut.

Die CLI bleibt iterativ entdeckbar: eine kompakte Cache-Übersicht im vorhandenen Session-Debug und eine gezielte Aufrufansicht mit Vergleich zum Vorgänger. Falls ein eigener Zweig nötig ist, ist `pibo debug cache --help` der Einstieg; die Implementierung legt seine unmittelbaren Unterbefehle konsistent zum vorhandenen Debug-CLI fest. Standardausgabe enthält keine kompletten Präfixe oder Ressourcenlisten. Ein ausdrücklich angeforderter tiefer Vergleich darf gespeicherte Pakete einmalig lesen, aber keinen neuen Modellaufruf auslösen.

## Budgets und Fehlerverhalten

| Bereich | Verbindliches Budget bzw. Verfahren |
|---|---|
| Normaler Turn | Zusätzliche Arbeit O(1) in bereits gespeicherter Historienlänge; allenfalls O(neuer Inhalt) im bestehenden Schreib-/Serialisierungspfad. Keine zusätzliche O(Gesamthistorie)-Runde. |
| Persistenter Platz | O(ein Paket plus notwendige Ressourcen pro Präfix-Version) und kleine O(Modellaufrufe)-Metadaten; keine O(Historie × Aufrufe)-Kopien. |
| Request-Metadaten | Höchstens 2 KiB zusätzliche serialisierte Diagnosemetadaten pro Modellaufruf; vorhandene Usage-/Korrelationsfelder werden wiederverwendet. |
| Diagnose-CPU | Im reproduzierbaren Docker-Benchmark p95 höchstens 1 ms zusätzlich pro Modellaufruf auf dem Gateway-Hauptthread; Durchsatz und Event-Loop-Verzögerung separat berichten. |
| Wiederaufnahme | Ein Paket lesen/prüfen, keine aktuellen Quellen scannen. Aufwand skaliert mit Paketgröße, nicht mit der bereits nativen Historie; native Ladezeit separat ausweisen. |
| Speichern beim Erstaufbau | Einmalige dauerhafte Versiegelung darf vor Dispatch warten. Latenz, Bytes und Schreibanzahl für 64 KiB, 1 MiB und 8 MiB messen; kein versteckter wiederholter fsync pro Turn. |
| Diagnosefehler | Bounded Queue und vorhandene best-effort Persistenz; Ausfälle oder verworfene Records zählen und als Diagnoselücke zeigen, Antwortfluss nicht blockieren. |
| Betriebszustandsfehler | Fehlgeschlagene Versiegelung/Wiederherstellung darf nicht als best-effort ignoriert werden; geschützter Dispatch bleibt gesperrt. |

Die CPU-Zahl ist ein Abnahmeziel, keine bereits gemessene Eigenschaft. Werden Budgets verfehlt, Ursache profilieren und implementieren; Budgets nicht still erhöhen. Kein umfangreiches Paketlesen auf dem Gateway-Hauptthread für Debug-Summen oder Warnberechnung.

# Umsetzungspakete und Reihenfolge

## Einstiegspunkte an der Planungsbaseline

Die Recherche an `planning_baseline` zeigt drei vorhandene Adapter: Pi, OMP und Codex-native. Die folgende Landkarte benennt bestehende Dateien und geeignete Integrationspunkte. Sie legt keine neue Abstraktion als bereits vorhanden aus. Eine gemeinsame Paketreferenz bedeutet insbesondere nicht, dass verschiedene Adapter daraus denselben Modell-Prompt erzeugen; Runtime-Wechsel bleibt eine Kompatibilitätsgrenze.

| Bereich | Bestehende Dateien/Symbole | Konkreter Arbeitsauftrag |
|---|---|---|
| Gemeinsamer Vertrag | `src/agent-runtime/types.ts`, `src/agent-runtime/capabilities.ts`, `src/agent-runtime/contract.ts` | `AgentRuntimeOpenServices`, Capability-Validierung und Session-Contract um Paket-/Resume-Vertrag ergänzen. Lieferart und Nachweisumfang getrennt führen. |
| Binding und CAS | `src/sessions/runtime-binding.ts`, `src/sessions/runtime-binding-persistence.ts` | `RuntimeSessionBinding` und vorhandenes autorisiertes `compareAndSet` erweitern; bestehende Revisions- und Autorisierungsprüfung wiederverwenden. |
| Session-Lebenszyklus | `src/agent-runtime/routed-session.ts`, `src/agent-runtime/portable-history.ts`, `src/agent-runtime/events.ts` | Fork/Clone/Rebind und Compaction-Ereignisse anbinden. Portable History ist begrenzt/redigiert und darf nicht als exakter nativer Replay verwendet werden. |
| Ressourcen | `src/agent-runtime/resources.ts`, `src/agent-runtime/resource-service.ts` | Versiegelte Lieferung von aktuellem Quellenaufbau trennen; permanente Paketressourcen von vergänglichen Credential-Leases unterscheiden. |
| Pi | `src/agent-runtimes/pi/runtime.ts`, `src/agent-runtimes/pi/routed-session.ts`, `src/core/system-prompt-template.ts`, `src/core/codex-compat.ts`, `src/tools/web-search.ts` | Capture nach Prompt-/Tool-Erweiterungen und Wiederaufnahme ohne Quellen-Refresh. Optionale Pi-Codex-Kompatibilität ist separat von Codex-native zu testen. |
| OMP | `src/agent-runtimes/omp/adapter.ts`, `src/agent-runtimes/omp/thread.ts`, `src/agent-runtimes/omp/resource-delivery.ts`, `src/agent-runtimes/omp/turn.ts` | Materialisierte Context-/Skill-Lieferung und OMP-Systemanweisungen einbeziehen. Unterstützte native Operationen respektieren; aktuell fehlendes Clone/Running-Fork nicht als Nebenprojekt implementieren. |
| Codex-Start/Resume | `src/agent-runtimes/codex-native/thread.ts`, `src/agent-runtimes/codex-native/resource-delivery.ts` | `CodexNativeThreadController.start/resume` übernehmen derzeit auch `developerInstructions` und `config`; `buildDeveloperInstructions` erzeugt Beiträge aus Ressourcen. Diese Eingaben exakt einfrieren; native zusätzliche Promptbildung separat nachweisen. |
| Codex-Dauerhaftigkeit | `src/agent-runtimes/codex-native/first-use.ts`, `src/agent-runtimes/codex-native/turn.ts` | Bestehende First-Use-Recovery und `thread/compact/start` integrieren. First-Use-Prompt-Hash bezeichnet User-Input und ist kein Hash des endgültigen Modell-Präfixes. |
| Usage und Writer | `src/core/events.ts`, `src/core/runtime-telemetry.ts`, `src/data/telemetry.ts`, `src/data/telemetry-writer.ts` | `PiboAssistantUsageEvent` und isolierten Writer verwenden. Nicht voraussetzen, dass genau eine Modellinferenz einem Provider-Transportdatensatz entspricht; nötigenfalls kleine Inferenz-Row mit stabiler `usageIndex`-Identität ergänzen. |
| Trace und CLI | `src/shared/trace-event-projection.ts`, `src/debug/telemetry.ts`, `src/debug/trace.ts` | Bestehende Inferenzzuordnung (`attachModelInferenceToLatestOutput`) erweitern; korrelierte Vergleichsdaten bounded lesen. |
| Kontextinspektion | `src/core/context-build.ts`, `src/apps/chat-ui/src/session-header-usage.tsx` | Paket-/Nachweisstatus sichtbar machen, ohne einen erfundenen vollständigen Codex-Prompt oder aus Header-Prozentwerten abgeleitete Cache-Zähler darzustellen. Warnung gehört zur bestehenden Inferenzdarstellung im Terminal. |

Codex-native deklariert derzeit keine rohen nativen Events und stellt an dieser Grenze keinen vollständigen finalen Prompt-Capture bereit. Das ist eine konkrete offene Abhängigkeit für die stärkste Garantie, keine Erlaubnis, die Anforderung auf reine Dateigleichheit abzuschwächen. Eine unterstützte native Version mit geprüftem Resume-Vertrag oder eine notwendige Schnittstellenerweiterung muss den fehlenden Nachweis liefern. Die ersten Implementierungsschritte dürfen Pibo-seitige Stabilität bereits verbessern; sie müssen ihren beschränkten Nachweisumfang ehrlich anzeigen.

Bestehende zuständige Spezifikationen sind [Adaptervertrag](/specs/runtime/adapter-contract.md), [Binding/History-Handoff](/specs/runtime/session-binding-and-history-handoff.md), [Ressourcen](/specs/runtime/generation-resources-and-portable-tools.md), [Pi](/specs/runtime/pi-adapter.md), [OMP](/specs/runtime/omp-adapter.md), [Codex-native](/specs/runtime/codex-native-adapter.md), [Session-Speicher](/specs/data/sessions-and-runtime-bindings.md), [Telemetrie](/specs/data/telemetry.md) und [Terminal-Debug](/specs/web/trace-terminal-scrolling-and-workflow-projection.md). Nach Umsetzung diese Eigentümer aktualisieren, keine konkurrierende allgemeine Spezifikation anlegen.

## Phase 0 — Vertragsnachweis und reproduzierbare Ausgangslage

Alle registrierten Runtime-Adapter und verwendeten nativen Versionen erfassen. Für jeden Adapter den endgültigen präfixwirksamen Zustand, Hooks, Start/Resume, native Historie, Cache-Key und Compaction-Grenze dokumentieren. Einen deterministischen Fake-Provider bzw. unterstützten Request-Recorder im isolierten Docker-Worker verwenden, um einen bereits langen Verlauf vor und nach Runtime-Neuaufbau zu vergleichen. Kein bezahlter 150k-Aufruf für den lokalen Nachweis.

Ergebnis ist eine Adaptermatrix mit Belegen und konkret benannten nativen Erweiterungen, falls Capture/Restore derzeit unmöglich ist. Für Codex-native darf die Phase nicht mit der bloßen Annahme enden, `thread/resume` konserviere alle unsichtbaren Anweisungen. Unabhängige Arbeit an Persistenz und Pi kann parallel vorangehen; die Gesamtabnahme bleibt bei fehlendem Adapterbeleg offen.

## Phase 1 — Persistenz und Vertrag

Versioniertes Paket, Session-Bindung, Epochen und atomare Versiegelung implementieren. Den bestehenden Session-Speicher und dessen Migration erweitern. Integritätsprüfung, referenzbasierte Löschung, Backup und Fail-closed-Wiederaufnahme bauen. Gemeinsame Adapter-Konformitätstests vor adapterindividuellen Sonderwegen bereitstellen.

Lieferung: T02/T03/T07/T09 grün, kein produktiver Neuaufbaupfad darf eine versiegelte Session überschreiben. Ein Feature-Schalter dient dem Rollout neuer Sessions; er darf bestehende geschützte Sessions nicht heimlich auf alten Neuaufbau zurückschalten.

## Phase 2 — Pi vollständig anbinden

Native Session-Bindung erhalten und Capture hinter sämtliche präfixwirksamen Erweiterungen legen. Kontext-/Skill-Lader, Basisprompt-Template, verfügbare Tools, optionale Codex-Kompatibilitätsanweisungen und Websearch-Hooks müssen eingefrorenen Zustand verwenden. `before_provider_request` und Payload-Wrapper auf spätere Änderungen prüfen. Runtime-Pfade, Datum, aktuelle Quelldateien und Tool-Reihenfolge gezielt im Test verändern.

Lieferung: T01/T04/T08 für Pi einschließlich aktivierter optionaler Erweiterungen und nativer Tool-Roundtrips. Kein stiller nativer History-Rewrite durch Normalisierung beim Laden. Pi-Unterstützung allein ist kein Abschluss des Gesamtplans.

## Phase 3 — Codex-native, OMP und weitere registrierte Adapter

Den gemeinsamen Vertrag in nativen Thread-Start/Resume und Ressourcenbereitstellung integrieren. Gespeicherte native Einstellungen und Instruktionen wiederverwenden; von der Runtime verwaltete Promptteile nicht doppelt injizieren. Erforderliche native Schnittstellenerweiterungen versionieren und deren Kompatibilität testen. Andere registrierte produktive Adapter erhalten dieselbe Testmatrix; nicht registrierte theoretische Runtimes müssen nicht vorab implementiert werden.

Lieferung: Jede produktive Adapterzeile besteht T04/T08 oder bleibt mit konkret benannter Abhängigkeit offen. Eine ausschließlich auf Pibo-Dateien begrenzte Stabilitätsprüfung wird als Teilnachweis ausgewiesen und erfüllt PIBO-PREFIX-004 noch nicht.

## Phase 4 — Lebenszyklus und Migration

Compaction, Modell-/Runtime-Wechsel, Fork/Import, Upgrade, Backup und Löschung anbinden. Übergänge idempotent und crash-sicher ausführen. Alt-Sessions inventarisieren, exakt übernehmbare Zustände versiegeln und nicht rekonstruierbare Zustände sichtbar behandeln. Keine automatische Massen-Rebasierung und kein erzwungenes Leeren von Nutzerhistorien.

Lieferung: T05/T06/T07/T09; nachvollziehbarer Migrationsreport mit Anzahl geschützt, Altbestand ungeprüft und Reparatur erforderlich. Historische Cache-Ursachen werden durch die Migration nicht nachträglich erfunden.

## Phase 5 — Usage, Telemetrie und Debug

Bestehende Modellaufruf-Korrelation und Usage-Normalisierung nutzen. Kompakte Cache-Beobachtung und deterministische Warnregel einführen. CLI und Chat-Debug aus derselben Vergleichslogik speisen, damit sie nicht unterschiedliche Ursachen behaupten. Provider-Diagnostik nur nach Capability-Nachweis ergänzen.

Lieferung: T10/T11/T12/T14; Screenshot des Debug-Falls und CLI-Ausgabe mit denselben Zahlen, Ursachenklassen und Unsicherheiten. Standard-Telemetrie enthält keine vollständigen Präfixe.

## Phase 6 — Performance, integrierte Abnahme und Freigabe

Fokussierte und relevante vollständige Tests, Build und Docker-Lastvergleich ausführen. Den exakt gleichen committed, inhaltadressierten Kandidaten auf einem isolierten Pibo2-Lease installieren. Dort authentifiziert echte Session-Wiederaufnahme, Compaction sowie Debug-Pfad prüfen; UI-Annahme mit headful Browser Use und CDP-Belegen. Bezahlte Providerprüfungen klein und explizit budgetiert halten: Sie ergänzen den lokalen Gleichheitsnachweis, ersetzen ihn aber nicht.

Erst danach einen fokussierten Code-PR gegen `upstream/dev` öffnen. Mehrere PRs sind möglich, wenn jeder eine sichere, geprüfte Zwischenstufe liefert; „alle Runtimes fertig“ erst nach vollständiger Matrix. Keine Installation eines Kandidaten oder Neustarts am Controller-Host. Relevante aktuelle Spezifikationen erst nach Implementierung aktualisieren und Belege verlinken.

# Test- und Abnahmematrix

Vorhandene Tests erweitern und die neuen Invarianten mit einer wiederverwendbaren Adapter-Suite abdecken. Einstiegskommandos an der Planungsbaseline, ausschließlich im isolierten Docker-Worker und mit den für die Tests erforderlichen Build-Artefakten:

```bash
npm run build
npm run typecheck
node --test test/runtime-session-binding.test.mjs test/runtime-portability.test.mjs test/runtime-restart-recovery.test.mjs test/agent-runtime-registry.test.mjs
node --test test/codex-native-thread.test.mjs test/codex-native-turn.test.mjs test/codex-native-resources.test.mjs
node --test test/omp-runtime.test.mjs test/omp-resources.test.mjs test/codex-compat.test.mjs test/base-prompt.test.mjs
node --test test/runtime-telemetry.test.mjs test/telemetry-store.test.mjs test/telemetry-writer.test.mjs test/telemetry-worker-isolation.test.mjs
node --test test/debug-trace-checks.test.mjs test/debug-trace-status.test.mjs test/context-build-inspector.test.mjs
npm run docs:validate
npm run docs:indexes:check
npm run docs:log:check
npm run docs:validator:test
```

Die Liste ist ein konkreter Einstieg, kein Ersatz für neue Präfix-Konformitätstests, relevante vollständige Projektprüfungen und die UI-Abnahme. Vorhandene Tests zu Codex First-Use-Recovery, revisioniertem Binding, begrenzter Portable History und isoliertem Telemetrie-Writer müssen erhalten bleiben. Nicht unterstützte native Operationen bleiben in der Adaptermatrix als solche markiert; Präfixschutz darf darüber keine zusätzlichen Fork-/Clone-Fähigkeiten vortäuschen.

| Test | Szenario und erforderlicher Nachweis |
|---|---|
| T01 | Gleiche native Historienrevision vor/nach Runtime-Neuaufbau an Request-Grenze vergleichen. Bei zusätzlicher Nachricht muss der alte tokenrelevante Präfix unverändert sein; transportbezogene Felder getrennt behandeln. 1k-, 100k- und 200k-tokenähnliche Fixtures lokal ohne Providerkosten. |
| T02 | Crash vor/nach Paket-Schreiben, Veröffentlichung, Bindungscommit und erstem Dispatch; defekte Länge, Digest, fehlendes Artefakt, unbekannter Codec. Kein stiller Neuaufbau, keine ungeschützte Anfrage. |
| T03 | Gleichzeitiger Erstaufbau/Resume derselben Session und Crash des Lock-Inhabers: genau eine gültige Bindung, kein konkurrierendes Überschreiben. |
| T04 | Adapter-Konformität für jede produktive Runtime und optionale Betriebsarten; nachträgliche Hooks, native Systemtexte, Roles, Tools, Reasoning-Items, Reihenfolge und Versionswechsel abdecken. Verborgene Provideranteile ausdrücklich als Grenze benennen. |
| T05 | Compaction und Crash während Übergang: neue Historienepoche, korrekte native History-Bindung, wieder stabiler Folgepräfix, kein falscher Cache-Verlustalarm. |
| T06 | Modell-/Provider-/Runtime-Wechsel, bewusster Basis-Refresh und Abbruch eines Übergangs: keine stillen Änderungen und keine Vergleichswerte aus falscher Epoche. |
| T07 | Bestehende Sessions mit exaktem, fehlendem und nur vermutetem Präfix; keine rückwirkende Garantie. Backup/Restore und inkompatibles Upgrade/Downgrade einschließlich Reparaturpfad. |
| T08 | Datum, CWD, Runtime-Generation, Quellinhalte, Tool-Reihenfolge und Skills ändern; gleiche Session bleibt stabil. Effektiven sichtbaren Cache-Key vor/nach Resume prüfen. Verbindungs-Neuaufbau und nativen Thread-Neuaufbau auseinanderhalten. |
| T09 | Fork/Clone, Export/Import, Berechtigungswiderruf und gemeinsame Paketreferenzen: kein vorzeitiges Löschen, keine übernommene fremde Identität als aktuelle Information, keine eingefrorenen Credentials. |
| T10 | 154255/3712/150543 und 155937/153984/1953 korrekt darstellen. Mehrere Toolcalls, Endturn, kumulative Usage, Cache-Writes, Retries, Abbruch, fehlende Usage und verspätete Events zählen genau einmal pro tatsächlichem Modellaufruf. |
| T11 | Warmer Vorgänger, starker Einbruch, Teiltreffer, kalter Start, Compaction, Inaktivität, gleiche/andere Keys, fehlende Telemetrie und Providerfehler. Ursachenbeweis und Korrelation nicht verwechseln; Schwellen an beiden Grenzen testen. |
| T12 | CLI-Hilfe schrittweise entdeckbar; Debug-UI headful für Toolcall/Endturn und mehrere Tools prüfen. Warnung, Zahlen, Vergleich und unbekannte Ursache stimmen mit Backend überein. |
| T13 | Vorher/nachher unter gleichem Docker-Limit und repräsentativer Parallelität: CPU, p50/p95/p99, Event-Loop-Lag, Heap, RSS, Disk-I/O, Zusatzbytes, Time-to-first-token ohne Providerzeit sowie Resume-Latenz messen. 100k-Historie darf keine zusätzliche per-Turn-Gesamtkopie erzeugen. |
| T14 | Standard-Logs und Telemetrie auf rohe Prompts, Ressourceninhalte und Secrets prüfen; langsamer/ausgefallener Telemetriespeicher beeinflusst Antwortfluss nicht. Snapshot-Speicherfehler bleibt dagegen sichtbar fatal für geschützten Dispatch. |

Eine hohe reale Cache-Quote ist ein ergänzendes Kosten-/Betriebssignal. Der harte lokale Abnahmetest ist exakte Wiederherstellung am kontrollierbaren Modell-Request-Rand, nicht ein zufällig warmer Provider-Cache. Bereits bestehende testrelevante Fehler dokumentieren und von Regressionen abgrenzen; fehlende Adapterbelege oder verfehlte neue Invarianten sind keine akzeptierte Restarbeit.

# Risiken, Rollout und Rücknahme

Größtes technisches Risiko ist ein nativer Harness, der Teile des endgültigen Prompts ohne Capture-/Restore-Vertrag erzeugt. Das ist früh in Phase 0 zu klären. Zweites Risiko ist scheinbare Unveränderlichkeit trotz späterer Hooks oder mutable Ressourcen. Deshalb reicht ein erfolgreicher Snapshot-Roundtrip ohne Request-Nachweis nicht aus.

Ein eingefrorener Präfix kann veraltete Hinweise enthalten. Das ist die gewollte Session-Semantik; neue Informationen können angehängt und notwendige Basisänderungen sichtbar durchgeführt werden. Sicherheitskorrekturen an ausführbaren Tools und aktuelle Zugriffskontrolle werden dadurch nicht abgeschaltet. Eine inkompatible Sicherheitskorrektur kann einen ausdrücklich erklärten Übergang erfordern.

Rollout zuerst für neue Sessions im Docker-Worker, dann auf Pibo2, anschließend in der freigegebenen Produktversion. Diagnose und Präfixschutz erhalten getrennte Schalter: Diagnose kann abgeschaltet werden, ohne den Sessionvertrag zu brechen. Bei Problemen neue Versiegelungen stoppen; bestehende geschützte Sessions müssen weiter mit kompatiblem Reader laufen oder mit nachvollziehbarem Wiederaufnahmefehler stoppen. Ein altes Binary, das die Bindung ignoriert, ist kein zulässiger stiller Rollback.

Schemaänderungen zunächst additiv ausführen. Mindestversion für Reader/Writer und Downgrade-Regeln dokumentieren. Pakete und Bindungen sichern; keine destruktive Migration, bevor Backup/Restore und Fork-Referenzen geprüft sind. Implementierungsbedingte Einschränkungen für Altbestand im Release sichtbar machen.

# Abschluss und Übergabe

Der implementierende Agent soll diesen Plan als vollständigen Auftrag verwenden, beginnend mit Phase 0. Er arbeitet in einem eigenen Branch/Worktree ab aktuellem `upstream/dev` und im isolierten Docker-Worker. Die oben genannte Baseline dient zur Orientierung; vor Änderungen die tatsächlichen Schnittstellen und konkurrierenden Änderungen abgleichen.

Fertig ist der Umbau erst, wenn alle Anforderungen und Tests belegt sind, jede produktive Runtime den Vertrag erfüllt, Altbestand einen ehrlichen Migrationsstatus besitzt, Debug und CLI denselben Cache-Einbruch erklären und die Performance-Budgets eingehalten werden. Der Abschlussbericht enthält Commit/Kandidat, Adaptermatrix, Testergebnisse, Performance-Vergleich, Pibo2-Nachweise und verbleibende ausschließlich providerseitige Ungewissheiten.

Dieser Plan wird nach erfolgreicher Umsetzung mit Verweisen auf die normativen Nachfolgespezifikationen abgeschlossen und gemäß Dokumentationsprofil archiviert. Bis dahin bleibt er unter `docs/plans/`; er darf nicht als Beschreibung bereits ausgelieferter Garantien veröffentlicht werden.
