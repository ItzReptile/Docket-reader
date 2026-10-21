-- One-time setup for a local Postgres. Run as a superuser:
--   psql -U postgres -h localhost -f scripts/create-db.sql
-- The password here is for a local dev database only; change it if your
-- Postgres is reachable from other machines.
create role docket login password 'docket';
create database docket owner docket;
