-- Run this once as the postgres superuser to create the Fibott app role + database.
-- Usage (from a terminal, will prompt for your postgres password):
--   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -f "C:\Users\PC\Fibott\scripts\create-db.sql"

CREATE ROLE fibott_app WITH LOGIN PASSWORD 'wsS8diuXBJwNSBGYKr0kqUj';
CREATE DATABASE fibott OWNER fibott_app;
GRANT ALL PRIVILEGES ON DATABASE fibott TO fibott_app;
