-- SlideRoom security verification queries.
-- Run these in Supabase SQL Editor after applying supabase/schema.sql.

-- 1. RLS must be enabled on every public app table.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'profiles',
    'rooms',
    'room_members',
    'files',
    'slides',
    'exports',
    'usage_events',
    'audit_logs',
    'app_admins',
    'app_state'
  )
order by tablename;

-- 2. Public app tables should have policies.
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 3. Storage bucket must stay private.
select
  id,
  public,
  file_size_limit
from storage.buckets
where id = 'slideroom-uploads';

-- 4. Storage policies must exist for private room-scoped objects.
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'storage_%'
order by policyname;

-- 5. Security definer helper functions must be in the private schema only.
select
  n.nspname as schema_name,
  p.proname as function_name,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname in ('is_room_member', 'can_manage_room')
order by schema_name, function_name;

-- 6. No public schema security-definer helper should remain.
select
  n.nspname as schema_name,
  p.proname as function_name,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef = true;

-- 7. Admin registry must not be directly readable by browser roles.
select
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'app_admins'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;
