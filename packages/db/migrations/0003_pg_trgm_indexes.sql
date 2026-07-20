-- DB-015: adminService.listUsers uses ilike with leading wildcard (%query%).
-- A btree index on phone can't serve a leading-wildcard LIKE. pg_trgm GIN
-- indexes support trigram-based fast ILIKE on text columns.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS users_phone_trgm ON users USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_name_trgm ON users USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_email_trgm ON users USING gin (email gin_trgm_ops);
