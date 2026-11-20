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

## Modellgrenze

`readLocalPlaylistModel()` in `lib/playlist-model.js` liest einen Browser-Snapshot. Die Music Library bleibt die Quelle für Track-Metadaten und Anbieter-IDs. Eine Playlist speichert ihre eigene ID, den Namen, künftig eine Ordnerreferenz und gegebenenfalls eine separate Spotify-Playlist-ID. Jeder Playlist-Eintrag referenziert genau einen vorhandenen Library-Track und hat eine Position innerhalb seiner Playlist. Export und Set-Planung können später die Metadaten aus der Library zu dieser Reihenfolge laden.

Die explizite `trackIds`-Liste hat Vorrang, auch wenn sie leer ist. Falls sie fehlt, ergibt sich die Reihenfolge aus `tracks[].playlistId` und der Reihenfolge im Browser-Snapshot. Wiederholungen erhalten eigene Einträge. Fehlende oder mehrdeutige Referenzen erscheinen als Diagnosen mit ihrer ursprünglichen Position. Die Funktion schreibt keine Daten. Die App nutzt weiterhin ihren bestehenden Speicherpfad.

| Lokales Modell | Zuordnung nach Supabase |
| --- | --- |
| `playlist.id`, `name`, `folderId`, `spotifyPlaylistId` | `playlists.id`, `name`, `folder_id`, `spotify_playlist_id`. Alte IDs bei Bedarf über eine stabile ID-Zuordnung übernehmen. Browser-Playlists liegen derzeit auf der obersten Ebene. |
| `membership.playlistId`, `libraryTrackId`, `position` | `playlist_tracks.playlist_id`, `library_track_id`, `position`. Die Position ist eine Ganzzahl ab null und pro Playlist eindeutig. |
| `membership.key` | Reproduzierbarer Leseschlüssel aus Playlist, Track und Vorkommen. Beim späteren Speichern einmal eine dauerhafte `playlist_tracks.id` als UUID pro Eintrag vergeben. Danach über diese UUID umsortieren, auch bei wiederholten Tracks. |
| Kontozuordnung | `user_id` aus der authentifizierten Sitzung ableiten. PR #4 erzwingt dieselbe Benutzer-ID bei Playlist-, Track- und Ordnerreferenzen. |

## Nächste Entwicklungsschritte

1. Playlist-Operationen für Erstellen, Umbenennen, Hinzufügen und Entfernen ergänzen. Das Entfernen eines einzelnen Vorkommens lässt den Library-Track und andere Playlists bestehen. Anschliessend die Leseansicht in die bestehende App einbinden und ältere Backups als Regressionstest abdecken.
2. Drag & Drop auf dauerhafte Eintrags-IDs stützen. Bei späterer Cloud-Speicherung die Positionsänderungen gemeinsam und mit Prüfung auf zwischenzeitliche Änderungen übernehmen. Für Ordner und Unterordner `playlist_folders.parent_id` nutzen und Zyklen beim Verschieben transaktional verhindern.
3. Smart Playlists über validierte Regeln auf der privaten Library berechnen. Automatische Set-Reihenfolgen als getrennte, editierbare Vorschläge speichern und die Playlist-Reihenfolge erhalten.
4. Die geordnete Playlist an die bestehenden Exportpfade anbinden. Beim Beatport-Export die Identitätsprüfung, Auftragsverwaltung und Verifikation aus PR #3 beibehalten. Beim Rekordbox-Export die Track-Sammlung und die Reihenfolge der Playlist-Einträge getrennt aufbauen. Lokale Dateipfade und Importkompatibilität im Zielprogramm separat prüfen.
