-- Runs once on first Postgres container start.
-- Creates the non-superuser app role that row-level security applies to;
-- migrations run as the postgres superuser (DATABASE_URL_ADMIN).
CREATE ROLE movie_app LOGIN PASSWORD 'movie_app';
GRANT CONNECT ON DATABASE movie TO movie_app;
GRANT USAGE, CREATE ON SCHEMA public TO movie_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO movie_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO movie_app;
