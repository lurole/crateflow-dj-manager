# CRATEFLOW 2.0 – Supabase-Fundament

## Umfang und Zugriff

Die Migrationen unter `supabase/migrations/` legen acht private Tabellen an. `profiles`, `library_tracks`, `playlist_folders`, `playlists` und `playlist_tracks` bilden den persönlichen Bestand ab. `import_jobs` und `export_jobs` speichern den späteren Auftragsverlauf. `provider_connections` enthält benutzerbezogene Verbindungsmetadaten, ohne Zugangstokens zu speichern. Diese Phase startet keine Worker, importiert keine Browserdaten und integriert keine Zahlungen oder gemeinsamen Metadaten-Caches.

Die erste Migration aktiviert RLS und entzieht mögliche Standard-Grants im selben Commit wie die Tabellenanlage. Die zweite ergänzt Eigentümerregeln und spaltenbezogene Rechte. `auth.uid()` liefert den Besitzer neuer vom Benutzer erstellter Zeilen. Zusammengesetzte Fremdschlüssel erzwingen denselben Besitzer bei Playlist, Track, Ordner und Verbindungsreferenzen. Ein Trigger erstellt ein minimales Profil bei neuen Auth-Konten. Er kopiert keine E-Mail-Adresse oder ungeprüfte Profilmetadaten.

| Bereich | Zugriff des authentifizierten Nutzers |
| --- | --- |
| Profil | Eigenes Profil lesen, Anzeigenamen ändern. |
| Library | Eigene Tracks anlegen, lesen und löschen. Anzeigen- und DJ-Metadaten ändern. Ursprüngliche Identität und Verifikationsfelder bleiben für Bearbeitung durch vertrauenswürdige Backend-Prozesse reserviert. |
| Ordner und Playlists | Eigene Ordner verschachtelt anlegen, benennen, sortieren und löschen. Playlists dürfen eigene Ordner wechseln. Das Verschieben bestehender Ordner wartet auf eine transaktionale Backend-Operation mit Zyklusprüfung. |
| Playlist-Mitgliedschaft | Eigene Tracks in eigene Playlists einfügen, die Position ändern und Vorkommen löschen. Wiederholte Track-Vorkommen sind über unterschiedliche Positionen möglich. |
| Verlauf | Eigene Import-/Exportaufträge lesen. Clients können keine Aufträge oder Verifikationsstände erzeugen oder verändern. |
| Plattformverbindungen | Eigene Status-/Zeitinformationen und die interne UUID per Spaltenauswahl lesen. Externe Konto-Referenzen und alle Mutationen bleiben dem Backend vorbehalten. |

Alle Tabellen haben eine Besitzerreferenz auf `auth.users`. Bei einer autorisierten Kontolöschung kaskadiert die Datenbank nur dessen Zeilen. Die Phase enthält keine Lösch-API. Einzelne Verbindungszeilen mit einer MusicAPI-Track-Zuordnung müssen vor dem Löschen durch einen vertrauenswürdigen Prozess entkoppelt werden. Spotify-Track-ID, Beatport-Katalog-ID, MusicAPI-Item-ID und ISRC bleiben getrennt. Die MusicAPI-Item-ID benötigt eine gleichbesitzende Verbindungsreferenz.

## Umgebungsvariablen

Die isolierte Route `/api/cloud-auth` ist standardmässig deaktiviert. Auf Vercel Production liefert sie selbst mit gesetztem Flag 404. Setze die Variablen ausschliesslich lokal oder für eine ausgewählte, geschützte Preview.

| Variable | Inhalt |
| --- | --- |
| `CRATEFLOW_CLOUD_AUTH_ENABLED` | `true` aktiviert die isolierte Route lokal und in Preview. |
| `CRATEFLOW_CLOUD_AUTH_ORIGIN` | Exakte App-Origin ohne Pfad oder Wildcard. Lokal ist `http://127.0.0.1:3000` vorgesehen. Preview erfordert HTTPS und einen stabilen Host. Mutierende Requests müssen dieselbe Origin angeben. |
| `SUPABASE_URL` | Tatsächliche Project URL des lokalen oder isolierten Supabase-Projekts. Lokal ist Loopback-HTTP erlaubt. |
| `SUPABASE_PUBLISHABLE_KEY` | Tatsächlicher Schlüssel mit Präfix `sb_publishable_` aus diesem Projekt. Die Route liest ihn serverseitig und setzt keine Ausgabevariable im Frontend. |
| `CRATEFLOW_CLOUD_GOOGLE_ENABLED` | `true` erst nach eingerichteter Google-Konfiguration. Standardmässig aus. |

Die Route benötigt keinen `service_role`-Schlüssel, keinen Supabase Secret Key, kein DB-Passwort und kein Google Client Secret. Google- und SMTP-Secrets gehören in die geschützte Supabase-Konfiguration. Datenbankzugriff über Adminrollen bleibt auf Migration und Betrieb beschränkt.

Die Session nutzt das offizielle Supabase-SSR-SDK mit PKCE und hostgebundenen HttpOnly-Cookies. HTTPS setzt zusätzlich Secure und den `__Host-`-Präfix. SameSite=Lax erlaubt die OAuth-Rückkehr. Geschützte Identität wird durch `auth.getUser()` beim Auth-Dienst geprüft. Logout widerruft die aktuelle Refresh-Session und entfernt die Cloud-Auth-Cookies. Bereits ausgestellte Access-Tokens können bis zu ihrem Ablauf gültig bleiben. Browser-Library und bestehende Beatport-Verbindung sind separate lokale Zustände. [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client) · [Sign out](https://supabase.com/docs/reference/javascript/auth-signout)

## Lokale Einrichtung

1. Verwende Node.js 22 oder neuer und Docker. Installiere die gelockten Abhängigkeiten mit `npm ci --ignore-scripts`.
2. Starte den lokalen Stack aus dem Repository mit `npx supabase@2.122.1 start`. `supabase/config.toml` konfiguriert PostgreSQL 17 und einen lokalen Mail-Posteingang. Ein frisch gestarteter Stack wendet die versionierten SQL-Migrationen an. Für eine bereits laufende lokale Instanz zeigt `npx supabase@2.122.1 migration list --local` den Stand. `npx supabase@2.122.1 db push --local` wendet ausstehende Änderungen ausschliesslich lokal an.
3. Lies die lokale Project URL und den Publishable Key aus `npx supabase@2.122.1 status` und setze sie als `SUPABASE_URL` und `SUPABASE_PUBLISHABLE_KEY` in der Shell des lokalen Auth-Prozesses. Setze ausserdem `CRATEFLOW_CLOUD_AUTH_ENABLED=true` und `CRATEFLOW_CLOUD_AUTH_ORIGIN=http://127.0.0.1:3000`. Speichere keine echten Schlüssel in Git.
4. Starte `npm run dev:cloud-auth` und öffne `http://127.0.0.1:3000/api/cloud-auth`. Fordere für eine synthetische E-Mail-Adresse einen Code an und lies ihn im lokalen Posteingang unter `http://127.0.0.1:54324`. Prüfe Anmeldung, Logout und den bestätigten Kontostatus. Der lokale Server stellt ausschliesslich die Account-Route bereit.
5. Führe `npm test`, `npm run build` und `bash supabase/tests/run-isolation.sh` aus. Der letzte Befehl verwendet einen frischen PostgreSQL-Container ohne Netzwerk mit einer minimalen Auth-DB-Fixture. Die Node-Tests prüfen HTTP-, Cookie- und PKCE-Verhalten mit gemockten Supabase-Antworten. GitHub Actions führt beide Testarten ohne Musikprovider-Secrets aus. [Supabase CLI](https://supabase.com/docs/reference/cli/introduction) · [E-Mail-Templates lokal](https://supabase.com/docs/guides/local-development/customizing-email-templates)

## Geschützte Test-Preview

1. Lege ein separates Entwicklungs- oder Staging-Projekt in Supabase an. Prüfe die Projekt-ID und wähle eine Region für dieses Projekt. Verbinde die CLI ausschliesslich mit diesem Projekt. Prüfe danach `npx supabase@2.122.1 db push --linked --dry-run` und wende die angezeigten zwei Migrationen erst auf dem bestätigten Nicht-Produktionsprojekt an. In einem neuen Projekt werden Profile ab den ersten Auth-Anmeldungen erstellt.
2. Setze in Supabase Auth die feste HTTPS-Origin der geschützten Preview als Site URL. Füge die exakte URL `/api/cloud-auth?callback=1` auf dieser Origin zu den erlaubten Redirects hinzu. Verwende keine Wildcard für beliebige Preview-Domains.
3. Aktiviere E-Mail-Anmeldung und die erforderlichen Registrierungs-/Bestätigungseinstellungen. Verwende in den Magic-Link- und gegebenenfalls Bestätigungs-Templates `{{ .Token }}` und sechsstellige Codes. Für Staging ohne lokalen Posteingang muss SMTP und die erlaubte Empfängergruppe separat eingerichtet sein. Der Default-Mailer hat Einschränkungen.
4. Für Google erst einen OAuth-Web-Client für die Testgruppe einrichten. Trage in Google die genaue Supabase-Callback-URL aus dem Supabase-Dashboard ein. Hinterlege Client-ID und Secret im Google-Provider des Supabase-Projekts. Setze danach das Google-Flag in der geschützten Preview. Google prüft den Supabase-Callback, Supabase prüft den oben konfigurierten CRATEFLOW-Callback.
5. Setze die Umgebungsvariablen für genau diese Preview. Prüfe mit zwei Testkonten E-Mail-/Google-Login, Refresh, Logout und zwei isolierte Mandanten. Verifiziere Programm- und Data-API-Zugriffe mit den tatsächlich ausgestellten Nutzer-JWTs. Prüfe, dass die öffentliche App weiterhin ausschliesslich ihren Browserbestand verwendet. [Supabase Email OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless) · [Supabase Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) · [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

## Rückfall

Deaktiviere zuerst die Preview-Flags und widerrufe die betreffenden Test-Sessions bei Bedarf. Der bisherige Browser-Speicherpfad kann unabhängig weiterlaufen. In Staging nur auf einem entbehrlichen Testprojekt zurücksetzen. Bei bereits geschriebenen Daten eine Sicherung und eine additive Korrekturmigration vor destruktivem SQL einplanen.
