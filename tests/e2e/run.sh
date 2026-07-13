#!/bin/sh
set -eu

project="spine-e2e"
port="${TEST_DATABASE_PORT:-55432}"
compose="docker compose -p $project -f docker-compose.test.yml"

export DATABASE_URL="postgres://movie_app:movie_app@127.0.0.1:$port/movie"
export DATABASE_URL_ADMIN="postgres://postgres:postgres@127.0.0.1:$port/movie"
export BETTER_AUTH_SECRET="spine-e2e-auth-secret-at-least-32-characters"
export BETTER_AUTH_URL="http://127.0.0.1:4173"
export FIRECRAWL_API_KEY=""
export TMDB_API_KEY=""

cleanup() {
  $compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
$compose up --detach --wait
bunx drizzle-kit push --force
bun docker/apply-rls.ts
bunx playwright test "$@"
