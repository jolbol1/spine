#!/bin/sh
set -e

: "${BETTER_AUTH_SECRET:?BETTER_AUTH_SECRET is required}"

echo "Pushing database schema…"
bunx drizzle-kit push --force

echo "Applying row-level security policies…"
bun docker/apply-rls.ts

echo "Starting Spine on :3000"
exec bunx vite preview --host 0.0.0.0 --port 3000
