#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
image="postgres:17-alpine@sha256:526f86d93c6ea08fd3f1fe5605650cacc781b2c6013169a0ad8f42c7d3d84f32"
container="$(docker run --rm --network none -d -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=crateflow_test "$image")"
trap 'docker stop "$container" >/dev/null' EXIT

for attempt in {1..30}; do
  if docker exec "$container" pg_isready -q -h 127.0.0.1 -U postgres -d crateflow_test; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    docker logs "$container"
    exit 1
  fi
  sleep 1
done

for file in supabase/tests/auth-fixture.sql supabase/migrations/*.sql supabase/tests/isolation.sql; do
  docker exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d crateflow_test < "$file"
done
printf 'CRATEFLOW PostgreSQL isolation checks passed.\n'
