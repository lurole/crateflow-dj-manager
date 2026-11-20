# CRATEFLOW 2.0 — Vollständige deutschsprachige Projektübersicht

**Stand:** 20. November 2026 · **Status:** Fachliches Zielkonzept verabschiedet, technische Migration noch nicht umgesetzt.
**Repository:** [lurole/crateflow-dj-manager](https://github.com/lurole/crateflow-dj-manager)
**Anwendung:** [CRATEFLOW](https://crateflow-dj-manager.vercel.app/?app=1)

## 1. Projektidee
CRATEFLOW ist eine DJ-Workflow-Plattform zur zuverlässigen Überführung von Musikentdeckungen in eine strukturierte, wiederverwendbare Bibliothek. Nutzer kopieren Spotify-Song- oder Playlist-Links, CRATEFLOW löst Metadaten auf, identifiziert die richtige Beatport-Version, ergänzt BPM/Camelot-Key/Genre und unterstützt danach bei Playlist- und DJ-Set-Vorbereitung. Beatport-Playlist-Exporte werden nach der Übertragung kontrolliert. Das Produkt kauft keine Musik und hostet keine Audiodateien.

**Leitgedanke:** Der DJ möchte den richtigen Song – keine Prozentbewertungen oder technischen Erklärungen im Normalfall. Unsichere Versionen und Fehler müssen trotzdem sichtbar bleiben.

## 2. Beschlossener Funktionsumfang (31 Funktionen)
**Music Library (5):** intelligente Filter; persönliche Playlists und Ordner; Duplikaterkennung; Cloud-Synchronisierung; Import- und Kaufhistorie.

**Playlist Management (7):** Playlists erstellen/bearbeiten; Drag & Drop; Ordner/Unterordner; dynamische Smart Playlists; Beatport-Playlist-Export; Rekordbox XML-Export; automatische Set-Reihenfolge.

**DJ Intelligence (4):** Harmonic Mixing; automatische Set-Erstellung; BPM-/Key-Analyse bzw. Metadatenanreicherung; Set-Timeline.

**Integrations & Automation (7):** Spotify-Song-/Playlist-Import; Beatport-Matching; Metadatenanreicherung; verifizierter Beatport-Export; Rekordbox XML; Hintergrundimporte; spätere weitere Musikplattformen.

**User Accounts (8):** E-Mail-/Google-Login; Benutzerprofil; Cloud Library; verbundene Musikplattformen verwalten; Import-/Exporthistorie; Datenexport/Backup; Abonnements/Zahlungsverwaltung; Datenschutz/Kontolöschung.

**Explizit nicht vorgesehen:** eigenständige Music Discovery, Spotify-Playlist-Autosynchronisierung, gemeinschaftliche Playlists, persönliche Tags/Favoriten/Bewertungen, Beatport-Warenkorb- und Kaufautomatisierung, Benachrichtigungen als eigenes Feature.

## 3. Heutiger Stand (CRATEFLOW 1.x)
Derzeit läuft eine webbasierte, auf Vercel veröffentlichte Anwendung mit vanilla JavaScript, Node-basierten Vercel-API-Endpunkten und einer lokalen Musikbibliothek im Browser unter `localStorage['crateflow_v1']`.

Importe aus einzelnen Spotify-Links verwenden MusicLink; öffentliche Spotify-Playlists werden über MusicAPI eingelesen. Die Beatport-Suche verwendet bevorzugt API.SH; MusicAPI dient als Fallback. Beatport-Katalog-ID und MusicAPI-Playlist-ID werden nicht gleichgesetzt. Die Anwendung prüft Titel, Artists, Mix-Version und mögliche ISRC-Konflikte. BPM, Key und Genre werden soweit verfügbar ergänzt. Der Beatport-Export erstellt eine Playlist und versucht, die übermittelten Titel durch anschliessendes Auslesen zu verifizieren.

**Noch nicht vorhanden:** Benutzer-Login, Supabase-Datenbank, Geräte-Synchronisierung, serverseitige Import-Queue, vollwertige Ordner/Smart Playlists, fertiger Set-Generator, Zahlungsabwicklung. Die eigentliche Verarbeitung läuft noch im geöffneten Browser. Detaillierte Bestandserhebung: `CURRENT_SYSTEM.md`.

## 4. Zielarchitektur
- **Frontend:** bestehendes CRATEFLOW-Design weiterführen; Komponenten schrittweise modularisieren.
- **Hosting:** Vercel bleibt.
- **Authentifizierung:** Supabase Auth (E-Mail/Google).
- **Datenbank:** PostgreSQL bei Supabase.
- **Private Daten:** jede Library, Playlist, Setdefinition, Verbindung und Historie gehört eindeutig einem Benutzer; Row Level Security schützt diese Daten.
- **Gemeinsame Trackdaten:** nur ein kleiner bedarfsorientierter, verifizierter und lizenzrechtlich zulässiger Cache, kein vollständiger gescrapter Musikdienst-Katalog.
- **Backend:** zunächst modularer Monolith auf Vercel, mit getrennten Verantwortlichkeiten für Auth, Library, Musikprovider, Matching, Export und Billing.
- **Automatisierung:** später dauerhafte Queue und Worker, die Importe nach Tab-Schliessung fortsetzen.
- **Monetarisierung:** Free-/Pro-Modell und Stripe sind technische Optionen für die spätere Phase; konkrete Preise und Tarife sind noch nicht beschlossen.

## 5. Warum kein Vollkatalog?
Je mehr Benutzer CRATEFLOW hat, desto mehr Benutzer-Track-Verknüpfungen werden ohnehin benötigt. Ein globaler Vollkatalog würde zusätzliche Speicher-, Index-, Wartungs- und Lizenzkosten verursachen. Sinnvoller ist die Trennung zwischen:
1. **Dauerhaft:** persönlicher Eintrag und seine Organisation.
2. **Wiederverwendbar:** freigegebene/verifizierte Metadaten im begrenzten Cache.
3. **Kurzlebig:** Suchergebnisse, verfügbarkeitsabhängige Angaben, temporäre Jobs.

Das wichtigste Einsparpotenzial liegt voraussichtlich bei den externen API-Aufrufen, nicht beim reinen Textspeicher. Die erlaubte Cache-Nutzung muss aber für jeden Anbieter separat geklärt werden.

## 6. Datenbankprinzipien
Ein Nutzer speichert seine Musik in `library_tracks`. Verschiedene Beatport-Versionen dürfen nicht wegen desselben Namens zusammenfallen. `track_cache` enthält nur zulässige Metadaten; `track_identifiers` führt Spotify- und Beatport-IDs mit eindeutigen Namensräumen. `playlists`, `playlist_tracks`, `playlist_folders` und Smart-Playlist-Regeln verwalten Organisation ohne duplizierte Musikdatensätze. `dj_sets` und `dj_set_tracks` halten die separate Set-Reihenfolge und Timeline. `import_jobs` und `job_items` ermöglichen langfristig nachvollziehbare Hintergrundimporte. `export_jobs` dokumentiert externe Übertragungen und deren Prüfstatus.

Ein detailliertes logisches Schema mit Schlüssel- und Sicherheitsregeln steht in `DATA_MODEL.md`. Die Tabellen sind noch nicht in einer Datenbank angelegt.

## 7. Wichtigste Sicherheits- und Qualitätsanforderungen
- Authentifizierter Zugriff auf ausschliesslich eigene private Daten, mit getesteten RLS-Regeln.
- API-Schlüssel und Drittanbieter-Tokens niemals im Browser.
- Originale Spotify-Identität und Beatport-Identität separat erhalten.
- Keine automatische Verwechslung von Original Mix, Extended Mix, Radio Edit, Remix oder verschiedenen Masterings.
- Keine erfolgreiche Exportmeldung allein aufgrund einer akzeptierten API-Anfrage.
- Keine unbeabsichtigten Käufe, Warenkorb-Aktionen oder Downloads.
- Importaufträge mit Wiederaufnahme, begrenzten Wiederholungen, Idempotenz und Kostenbudget.
- Datenschutzkonformer Export und Löschung des Benutzerkontos.
- Vor kommerziellem Rollout die Nutzungsbedingungen der Musikdatenanbieter und die Anforderungen für Zahlungsdaten prüfen.

## 8. Entwicklung in sechs Phasen
**Phase 0 — Technischer Codex-Audit:** aktuelle Codequalität, Sicherheitslücken und Schnittstellen vor Implementierung prüfen.

**Phase 1 — Supabase & Login:** PostgreSQL-Schema, Auth und RLS im isolierten Entwicklungsprojekt.

**Phase 2 — Cloud Library & sichere Migration:** Daten unter `crateflow_v1` exportieren, Zuordnung prüfen, in Cloud übertragen und auf zweitem Gerät verifizieren. Browserdaten bis zur Freigabe erhalten.

**Phase 3 — Matching, Cache und Background Jobs:** Provider-Adapter, zentraler Cache, Job-Queue, Quoten, sichere Export-ID-Auflösung.

**Phase 4 — Playlist Workspace:** Unterordner, Drag & Drop, Smart Playlists, Beatport- und Rekordbox-Export.

**Phase 5 — DJ Intelligence:** Harmonic Mixing, Set-Generator, Timeline und verlässliche Dauerangaben.

**Phase 6 — Billing und Launch:** Tarifverwaltung, Account-Löschung/Export, Betrieb, Sicherheits- und Lasttests.

Die Implementierungsabschätzung aus der Planung beträgt grob **36–62 Entwicklungstage ab Phase 1**, ohne zusätzliche Auditzeit und unvorhergesehene Freigaben. Das ist keine Lieferzusage.

## 9. Risiken
- Falsche Aufnahme/Version: automatische Zuordnung muss konservativ bleiben.
- API.SH- und MusicAPI-IDs: benötigen separaten Abgleich beim Export.
- Caching-Lizenz: eventuell nur benutzerspezifische Speicherung zulässig.
- Browserdatenverlust: bestehende Library vor Migration als JSON sichern.
- Teilweise Beatport-Exporte: externe Schreiboperationen dürfen nicht blind wiederholt werden.
- Datenlecks: strikte Benutzerisolation und Kontrolle aller Backend-Endpunkte.
- Externe API-Kosten: zentral messen, begrenzen, wiederverwenden nur bei zulässigem Cache.
- Rekordbox: XML transportiert keine Audiodateien; Dateipfade müssen gültig sein.
- Set-Planung: BPM/Key allein garantiert keine musikalisch perfekten Übergänge.

## 10. Zusammenarbeit mit Codex
ChatGPT bleibt für Produktentscheidungen und UX/Architektur-Review. Codex übernimmt Repository-Audit, Refactoring, Tests, Datenbankmigrationen und isolierte Implementierungs-PRs. GitHub ist Source of Truth; Vercel Preview dient zur Qualitätskontrolle. Die produktive Version wird nicht ohne Tests und Freigabe überschrieben.

Codex erhält zuerst den **reinen Auditauftrag** in `CODEX_START_PROMPT.md`. `AGENTS.md` enthält verbindliche Entwicklerregeln. Erst nach dem Audit beginnt die konkrete Supabase-Implementierung.

## 11. Dokumentationsstruktur
- `README.md`: bestehendes MVP und lokale Entwicklung.
- `CURRENT_SYSTEM.md`: überprüfter technischer Ist-Zustand.
- `PRODUCT_REQUIREMENTS.md`: verbindliche Produktanforderungen.
- `ARCHITECTURE.md`: Zielsystem, Module und Datenflüsse.
- `DATA_MODEL.md`: relationales Schema und RLS-Ziele.
- `MIGRATION_PLAN.md`: Datenübernahme, Integrität und Rollback.
- `SECURITY_OPERATIONS.md`: Security, API-Limits, Betrieb und Incident-Prozesse.
- `ROADMAP.md`: Meilensteine, Aufwand, Risiken und Abnahme.
- `AGENTS.md`: Regeln für Codex.
- `CODEX_START_PROMPT.md`: direkt einsetzbarer erster Codex-Auftrag.
