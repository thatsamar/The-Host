-- Undo 20261127000001_advisor_foundations.sql. This deletes every stored
-- version of every advisor's private material and its history: export them
-- first (scripts/foundations.mjs export) and keep the private source. Every
-- advisor must be on the current architecture (or FOUNDATIONS_ENABLED off)
-- before running it.
drop trigger if exists advisor_active_record on public.advisor_active;
drop trigger if exists advisor_layers_immutable on public.advisor_layers;
drop table if exists public.advisor_events;
drop table if exists public.advisor_active_history;
drop table if exists public.advisor_active;
drop table if exists public.advisor_layers;
drop function if exists public.advisor_active_record();
drop function if exists public.advisor_layers_immutable();
