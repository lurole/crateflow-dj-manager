# CRATEFLOW – Vorbereitung der Phase-0-Integration

Geprüfter Produktionsstand am 20. November 2026 ist Commit `28d06b9` auf `main`. Die öffentliche Vercel-Domain zeigte auf das bereite Produktionsdeployment dieses Commits. Alle drei PRs waren offen und die GitHub-Actions- und Vercel-Preview-Checks erfolgreich.

| PR | Geprüfte Basis | Testresultat | Wirkung bei einer späteren Produktionsintegration |
| --- | --- | --- | --- |
| #1 `23d5201` | `main` | 55 bestanden, 6 definierte Regressionen | Test-Fixtures und Offline-CI. Vercel kann beim Merge neu bauen. Die Änderungen enthalten keinen anderen Anwendungscode. |
| #2 `32714d2` | PR #1 | 77 bestanden, 2 definierte Export-Regressionen | Neuer Import, Playlist-Zuordnungen und konservativeres Matching. Neu importierte Playlists schreiben Reihenfolge und Mehrfachmitgliedschaften ins vorhandene Browser-JSON. Alte Stände bleiben lesbar. Eine ältere App-Version zeigt Zusatzmitgliedschaften unter Umständen erst nach Rückkehr zur neuen Version wieder an. |
| #3 `b5e5d43` | PR #2 | 100 bestanden, keine erwarteten Fehlschläge | Neue Beatport-Export-Route mit Browserjournal, Prüfnachweisen und Read-back. Die neue UI und API gemeinsam ausrollen. Mehr MusicAPI-Reads pro Export und Web-Locks-Unterstützung im Browser sind zu berücksichtigen. Ein alter Client ohne Nachweis kann die neue Export-API nicht zum Schreiben nutzen. |

[PR #1](https://github.com/lurole/crateflow-dj-manager/pull/1) · [PR #2](https://github.com/lurole/crateflow-dj-manager/pull/2) · [PR #3](https://github.com/lurole/crateflow-dj-manager/pull/3) · [Vercel-Produktion](https://vercel.com/lurole/crateflow-dj-manager/4nHgzatYD2xhZvCeZAPNaAFd2J7j)

## Reihenfolge nach separater Freigabe

1. PR #1 prüfen und nach `main` mergen. Den Basisbranch bis zur bestätigten Umstellung des abhängigen PRs behalten. Merge-Commits erhalten die bereits geprüfte Commit-Abstammung.
2. PR #2 auf das aktualisierte `main` umstellen und Diff, CI und eine geschützte Preview prüfen. Dann nach eigener Freigabe mergen.
3. PR #3 erst auf `main` umstellen, wenn PR #2 integriert ist. Erneut Diff und Checks bestätigen. Vor Freigabe eines produktiven Exports die dokumentierten Grenzen, vertraglichen MusicAPI-Write-Rechte und einen budgetierten repräsentativen Integrationstest prüfen.
4. Phase 1 baut auf PR #3 auf. Bei einem Squash oder Rebase eines Vorgängers die abhängigen PRs zuerst auf das neue `main` übertragen und den Diff auf die jeweils eigene Phase begrenzen. Nach dem Retarget die Checks erneut ausführen.

Ein Merge nach `main` kann über die bestehende Git-Integration eine Produktionsbereitstellung auslösen. Für die Reihenfolge sind deshalb sowohl der Merge als auch das Deployment als Release-Schritte zu behandeln. Vor der Freigabe den aktuellen Production Branch, Review- und Check-Anforderungen sowie einen bekannten Rollback-Stand bestätigen. Phase 1 setzt die Cloud-Route weder in der bestehenden App noch in Vercel Production in Betrieb. Das Schema wird über Supabase separat und nur auf einem bestätigten Ziel ausgerollt. [Vercel und Git](https://vercel.com/docs/git)

## Sicherheitsbewertung der Integration

Die Offline-CI blockiert Netzwerkzugriffe in den Node-Test- und Build-Prozessen. Die Import- und Matching-Tests decken den Schutz des lokalen Bestands ab. Exporttests prüfen Track-Identität, Auth-Bindung, Wiederholungen sowie unklare Schreib- und Lesezustände. Diese Checks und eine bereite Vercel-Preview bestätigen keine realen Anbieterberechtigungen oder -kosten. Der Browser-Export braucht bei unbekanntem Create-Ergebnis weiterhin manuelle Prüfung. Die Beatport-Verbindung bleibt bis zur späteren Kontobindung unabhängig von CRATEFLOW Auth. [Exportgrenzen](BEATPORT_EXPORT.md)
