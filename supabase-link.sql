-- Run once in Supabase SQL Editor
alter table public.places
add column if not exists link text default '';
