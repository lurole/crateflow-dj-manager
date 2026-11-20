# CRATEFLOW 2.0 – Playlist-Datenmodell

## Ausgangslage

| Bereich | Stand nach PR #1 bis #4 |
| --- | --- |
| Music Library und Spotify-Import | `app.js` verwaltet Tracks und Playlists im Browser-Snapshot `crateflow_v1`. Importierte Playlists speichern geordnete `trackIds`. Ein Track kann in mehreren Playlists und mehrfach in derselben Playlist vorkommen. Ältere Backups kennen `tracks[].playlistId`. |
| Playlist-Verwaltung | Die Library kann Playlists als Filter anzeigen. Für neue Playlists, Umbenennen, manuelles Sortieren und Ordner gibt es noch keine eigene Verwaltung. |
| Beatport | Der verifizierende Export nimmt ausgewählte Studio-Tracks entgegen. Er prüft deren Anbieteridentität, protokolliert den Auftrag und liest die erstellte Playlist zurück. |
| Rekordbox | Der vorhandene XML-Export filtert die Library nach gültigen absoluten lokalen Dateipfaden und optional nach Download-Status. Er liest noch keine sortierte Playlist. |
| DJ-Sets und Smart Playlists | Der Mix-Bereich zeigt BPM- und Camelot-Kompatibilität. Eine gespeicherte Set-Reihenfolge und dynamische Playlist-Regeln gehören zum geplanten Modell. |
| Supabase | PR #4 definiert `library_tracks`, `playlists`, `playlist_tracks` und `playlist_folders` mit Benutzerisolation. Das Laufzeitverhalten dieser Phase wird lokal geprüft. |

## Integration in Phase 2.1

`lib/playlist-model.js` löst die Mitgliedschaften für den Library-Filter auf und verwaltet sie beim Import und beim bestätigten Löschen eines Library-Tracks. `readLocalPlaylistModel()` liefert eine geordnete Leseansicht mit Diagnosen. Die Music Library bleibt die Quelle für Track-Metadaten und Anbieter-IDs. Eine Playlist speichert ihre eigene ID, den Namen, künftig eine Ordnerreferenz und gegebenenfalls eine separate Spotify-Playlist-ID. Jeder Playlist-Eintrag referenziert genau einen vorhandenen Library-Track und hat eine Position innerhalb seiner Playlist. Export und Set-Planung können später die Metadaten aus der Library zu dieser Reihenfolge laden.

Die explizite `trackIds`-Liste hat Vorrang, auch wenn sie leer ist. Falls sie fehlt, ergibt sich die Reihenfolge aus `tracks[].playlistId` und der Reihenfolge im Browser-Snapshot. Wiederholungen erhalten eigene Einträge. Fehlende oder mehrdeutige Referenzen erscheinen in der Leseansicht als Diagnosen mit ihrer ursprünglichen Position. Im Playlist-Filter werden nur eindeutig zugeordnete Tracks angezeigt. Die gespeicherten Referenzen bleiben dabei erhalten.

Die App speichert weiterhin unter `crateflow_v1`. Laden und Filtern schreiben keine Benutzerdaten um. Neu importierte Tracks speichern die Zuordnung über `playlists[].trackIds`. Bestehende Tracks behalten ihr ursprüngliches `playlistId`. Ein Import in eine alte Playlist ergänzt deren explizite Liste erst bei einer Änderung. Spotify-Reimporte behalten vorhandene Positionen und ergänzen fehlende Vorkommen in Quellreihenfolge. Manuelle Importe behalten die bisherige Sortierung mit neuen Einträgen zuerst. Bei einem Rückfall auf den Stand von PR #4 bleiben diese Listen lesbar. Versionen vor der Einführung von `trackIds` können neu importierte Mitgliedschaften unter Umständen nicht anzeigen.

| Lokales Modell | Zuordnung nach Supabase |
| --- | --- |
| `playlist.id`, `name`, `folderId`, `spotifyPlaylistId` | `playlists.id`, `name`, `folder_id`, `spotify_playlist_id`. Alte IDs bei Bedarf über eine stabile ID-Zuordnung übernehmen. Browser-Playlists liegen derzeit auf der obersten Ebene. |
| `membership.playlistId`, `libraryTrackId`, `position` | `playlist_tracks.playlist_id`, `library_track_id`, `position`. Die Position ist eine Ganzzahl ab null und pro Playlist eindeutig. |
| `membership.id` | Dauerhafte UUID pro Vorkommen. Für Altbestände gibt es bis zur ersten Änderung temporäre IDs aus Playlist und Position. Bei einer späteren Übernahme kommen ausschliesslich dauerhafte UUIDs als `playlist_tracks.id` infrage. |
| Kontozuordnung | `user_id` aus der authentifizierten Sitzung ableiten. PR #4 erzwingt dieselbe Benutzer-ID bei Playlist-, Track- und Ordnerreferenzen. |

## Playlist-Editor in Phase 2.2

In der Music Library eine Playlist auswählen und **Edit playlist** öffnen. Der Editor zeigt die vollständige Reihenfolge. Tracks lassen sich per Drag & Drop oder über die Pfeiltasten-Schaltflächen verschieben. **Remove** betrifft ein Vorkommen der angezeigten Playlist. **Add track** hängt den gewählten Library-Track als neues Vorkommen an. Die Schaltflächen sind auch per Tastatur und auf Touchgeräten bedienbar.

Ein erfolgreicher Schreibvorgang speichert UUID und Track-Referenz pro Eintrag in `playlists[].memberships` sowie die gleich geordnete `trackIds`-Liste für frühere App-Versionen. Einträge behalten ihre UUID bei Verschieben, weiteren Importen und Neuladen. Wenn ein vorheriger App-Stand `trackIds` verändert hat, verwendet der Editor diese Liste und vergibt beim nächsten Bearbeiten neue UUIDs für die betreffende Playlist. Das Öffnen und Wiederherstellen eines alten Backups benötigt keine automatische Umschreibung.

Der Editor prüft vor dem Schreiben, ob sich der gespeicherte Bestand seit dem Laden oder letzten eigenen Speichern geändert hat. Bereits sichtbare Fremdänderungen führen zu einer Aufforderung zum Neuladen. `localStorage` bietet für nahezu gleichzeitige Schreibvorgänge aus mehreren Tabs keine gemeinsame Transaktion. Beim späteren Cloud-Speichern sollen Änderungen der Positionen in einer Transaktion erfolgen und gegen die gelesene Playlist-Revision geprüft werden.

## Nächste Entwicklungsschritte

1. Erstellen und Umbenennen von Playlists ergänzen. Für Ordner und Unterordner `playlist_folders.parent_id` nutzen und Zyklen beim Verschieben transaktional verhindern.
2. Smart Playlists über validierte Regeln auf der privaten Library berechnen. Automatische Set-Reihenfolgen als getrennte, editierbare Vorschläge speichern und die Playlist-Reihenfolge erhalten.
3. Die geordnete Playlist an die bestehenden Exportpfade anbinden. Beim Beatport-Export die Identitätsprüfung, Auftragsverwaltung und Verifikation aus PR #3 beibehalten. Beim Rekordbox-Export die Track-Sammlung und die Reihenfolge der Playlist-Einträge getrennt aufbauen. Lokale Dateipfade und Importkompatibilität im Zielprogramm separat prüfen.
