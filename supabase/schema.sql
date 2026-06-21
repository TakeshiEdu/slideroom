create table if not exists public.app_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

insert into storage.buckets (id, name, public, file_size_limit)
values ('slideroom-uploads', 'slideroom-uploads', false, 314572800)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

-- Production schema foundation.
-- The legacy app_state table remains for the current app while the application
-- is migrated to table-backed reads/writes in Phase 1.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id text primary key,
  title text not null check (char_length(title) between 1 and 140),
  class_name text not null default '',
  team_name text,
  description text,
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'waiting', 'ready', 'completed', 'archived')),
  access_mode text not null default 'invite' check (access_mode in ('invite', 'authenticated')),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{4,16}$'),
  invite_url text not null default '',
  presentation_at timestamptz,
  deadline_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.room_members (
  id text primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  role text not null default 'member' check (role in ('host', 'admin', 'member', 'viewer')),
  assigned_range text,
  joined_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create table if not exists public.files (
  id text primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  owner_name text not null check (char_length(owner_name) between 1 and 120),
  name text not null check (char_length(name) between 1 and 240),
  original_name text not null check (char_length(original_name) between 1 and 240),
  mime_type text not null default 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  extension text not null default 'pptx' check (extension = 'pptx'),
  size_bytes bigint not null check (size_bytes between 0 and 314572800),
  status text not null default 'submitted' check (status in ('submitted', 'not_submitted', 'revision_requested', 'reviewing', 'approved', 'excluded')),
  version integer not null default 1 check (version > 0),
  assigned_range text,
  slide_count integer not null default 1 check (slide_count > 0 and slide_count <= 1000),
  analysis_status text check (analysis_status in ('not_applicable', 'parsed', 'fallback', 'failed')),
  analysis_warnings text[] not null default '{}',
  storage_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_key like ('rooms/' || room_id || '/files/%.pptx'))
);

create table if not exists public.slides (
  id text primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  file_id text not null references public.files(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  owner_name text not null check (char_length(owner_name) between 1 and 120),
  title text not null check (char_length(title) between 1 and 240),
  section text not null default '',
  sort_order integer not null check (sort_order > 0),
  source_page integer not null check (source_page > 0),
  thumbnail_url text,
  is_placed boolean not null default true,
  is_duplicate boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exports (
  id text primary key,
  room_id text not null references public.rooms(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 240),
  format text not null check (format in ('pptx', 'pdf', 'zip')),
  status text not null check (status in ('success', 'failed')),
  download_storage_key text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  room_id text references public.rooms(id) on delete set null,
  event_type text not null,
  quantity bigint not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  room_id text references public.rooms(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner', 'admin', 'support')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rooms_host_user_id_idx on public.rooms(host_user_id);
create index if not exists rooms_invite_code_idx on public.rooms(invite_code);
create index if not exists room_members_room_id_idx on public.room_members(room_id);
create index if not exists room_members_user_id_idx on public.room_members(user_id);
create index if not exists files_room_id_idx on public.files(room_id);
create index if not exists files_owner_user_id_idx on public.files(owner_user_id);
create index if not exists slides_room_id_idx on public.slides(room_id);
create index if not exists slides_file_id_idx on public.slides(file_id);
create index if not exists exports_room_id_idx on public.exports(room_id);
create index if not exists usage_events_user_id_created_at_idx on public.usage_events(user_id, created_at desc);
create index if not exists audit_logs_room_id_created_at_idx on public.audit_logs(room_id, created_at desc);
create index if not exists app_admins_role_idx on public.app_admins(role);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.files enable row level security;
alter table public.slides enable row level security;
alter table public.exports enable row level security;
alter table public.usage_events enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_admins enable row level security;

revoke all on public.app_admins from public;
revoke all on public.app_admins from anon;
revoke all on public.app_admins from authenticated;
grant select, insert, update, delete on public.app_admins to service_role;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
grant usage on schema private to service_role;

create table if not exists private.api_rate_limits (
  key text primary key,
  count integer not null check (count > 0),
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table private.api_rate_limits enable row level security;
create index if not exists api_rate_limits_reset_at_idx on private.api_rate_limits(reset_at);
revoke all on private.api_rate_limits from public;
revoke all on private.api_rate_limits from anon;
revoke all on private.api_rate_limits from authenticated;
grant select, insert, update, delete on private.api_rate_limits to service_role;

drop function if exists private.is_room_member(text);
drop function if exists private.can_manage_room(text);
drop function if exists private.check_rate_limit(text, integer, integer);
drop function if exists public.check_rate_limit(text, integer, integer);
drop function if exists public.is_room_member(text);
drop function if exists public.can_manage_room(text);

create or replace function private.is_room_member(target_room_id text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.room_members
    where room_id = target_room_id
      and user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.rooms
    where id = target_room_id
      and host_user_id = (select auth.uid())
  );
$$;

create or replace function private.can_manage_room(target_room_id text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.rooms
    where id = target_room_id
      and host_user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.room_members
    where room_id = target_room_id
      and user_id = (select auth.uid())
      and role in ('host', 'admin')
  );
$$;

revoke all on function private.is_room_member(text) from public;
revoke all on function private.can_manage_room(text) from public;
grant execute on function private.is_room_member(text) to authenticated;
grant execute on function private.can_manage_room(text) to authenticated;

create or replace function public.check_rate_limit(rate_key text, max_count integer, window_seconds integer)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  current_count integer;
  current_reset_at timestamptz;
begin
  if rate_key is null or char_length(rate_key) < 16 or char_length(rate_key) > 128 then
    raise exception 'invalid rate limit key';
  end if;
  if max_count < 1 or max_count > 10000 then
    raise exception 'invalid rate limit max_count';
  end if;
  if window_seconds < 1 or window_seconds > 86400 then
    raise exception 'invalid rate limit window_seconds';
  end if;

  delete from private.api_rate_limits as limits
  where limits.reset_at < now() - interval '1 hour';

  insert into private.api_rate_limits as limits (key, count, reset_at, updated_at)
  values (rate_key, 1, now() + make_interval(secs => window_seconds), now())
  on conflict (key) do update
  set
    count = case
      when limits.reset_at <= now() then 1
      else limits.count + 1
    end,
    reset_at = case
      when limits.reset_at <= now() then now() + make_interval(secs => window_seconds)
      else limits.reset_at
    end,
    updated_at = now()
  returning limits.count, limits.reset_at
  into current_count, current_reset_at;

  allowed := current_count <= max_count;
  remaining := greatest(max_count - current_count, 0);
  reset_at := current_reset_at;
  return next;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public;
revoke all on function public.check_rate_limit(text, integer, integer) from anon;
revoke all on function public.check_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "rooms_select_member" on public.rooms;
create policy "rooms_select_member"
on public.rooms
for select
to authenticated
using (private.is_room_member(id));

drop policy if exists "rooms_insert_host" on public.rooms;
create policy "rooms_insert_host"
on public.rooms
for insert
to authenticated
with check ((select auth.uid()) = host_user_id);

drop policy if exists "rooms_update_manager" on public.rooms;
create policy "rooms_update_manager"
on public.rooms
for update
to authenticated
using (private.can_manage_room(id))
with check (private.can_manage_room(id));

drop policy if exists "rooms_delete_manager" on public.rooms;
create policy "rooms_delete_manager"
on public.rooms
for delete
to authenticated
using (private.can_manage_room(id));

drop policy if exists "room_members_select_member" on public.room_members;
create policy "room_members_select_member"
on public.room_members
for select
to authenticated
using (private.is_room_member(room_id));

drop policy if exists "room_members_insert_manager" on public.room_members;
create policy "room_members_insert_manager"
on public.room_members
for insert
to authenticated
with check (private.can_manage_room(room_id));

drop policy if exists "room_members_update_manager" on public.room_members;
create policy "room_members_update_manager"
on public.room_members
for update
to authenticated
using (private.can_manage_room(room_id))
with check (private.can_manage_room(room_id));

drop policy if exists "room_members_delete_manager_or_self" on public.room_members;
create policy "room_members_delete_manager_or_self"
on public.room_members
for delete
to authenticated
using (private.can_manage_room(room_id) or user_id = (select auth.uid()));

drop policy if exists "files_select_member" on public.files;
create policy "files_select_member"
on public.files
for select
to authenticated
using (private.is_room_member(room_id));

drop policy if exists "files_insert_owner_member" on public.files;
create policy "files_insert_owner_member"
on public.files
for insert
to authenticated
with check (private.is_room_member(room_id) and owner_user_id = (select auth.uid()));

drop policy if exists "files_update_owner_or_manager" on public.files;
create policy "files_update_owner_or_manager"
on public.files
for update
to authenticated
using (owner_user_id = (select auth.uid()) or private.can_manage_room(room_id))
with check (owner_user_id = (select auth.uid()) or private.can_manage_room(room_id));

drop policy if exists "files_delete_owner_or_manager" on public.files;
create policy "files_delete_owner_or_manager"
on public.files
for delete
to authenticated
using (owner_user_id = (select auth.uid()) or private.can_manage_room(room_id));

drop policy if exists "slides_select_member" on public.slides;
create policy "slides_select_member"
on public.slides
for select
to authenticated
using (private.is_room_member(room_id));

drop policy if exists "slides_insert_owner_or_manager" on public.slides;
create policy "slides_insert_owner_or_manager"
on public.slides
for insert
to authenticated
with check (owner_user_id = (select auth.uid()) or private.can_manage_room(room_id));

drop policy if exists "slides_update_member" on public.slides;
create policy "slides_update_member"
on public.slides
for update
to authenticated
using (private.is_room_member(room_id))
with check (private.is_room_member(room_id));

drop policy if exists "slides_delete_owner_or_manager" on public.slides;
create policy "slides_delete_owner_or_manager"
on public.slides
for delete
to authenticated
using (owner_user_id = (select auth.uid()) or private.can_manage_room(room_id));

drop policy if exists "exports_select_member" on public.exports;
create policy "exports_select_member"
on public.exports
for select
to authenticated
using (private.is_room_member(room_id));

drop policy if exists "exports_insert_member_self" on public.exports;
create policy "exports_insert_member_self"
on public.exports
for insert
to authenticated
with check (private.is_room_member(room_id) and created_by = (select auth.uid()));

drop policy if exists "exports_delete_manager" on public.exports;
create policy "exports_delete_manager"
on public.exports
for delete
to authenticated
using (private.can_manage_room(room_id));

drop policy if exists "usage_events_select_self" on public.usage_events;
create policy "usage_events_select_self"
on public.usage_events
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "usage_events_insert_self" on public.usage_events;
create policy "usage_events_insert_self"
on public.usage_events
for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "audit_logs_select_room_manager" on public.audit_logs;
create policy "audit_logs_select_room_manager"
on public.audit_logs
for select
to authenticated
using (room_id is not null and private.can_manage_room(room_id));

drop policy if exists "storage_select_room_member" on storage.objects;
create policy "storage_select_room_member"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'slideroom-uploads'
  and (storage.foldername(name))[1] = 'rooms'
  and private.is_room_member((storage.foldername(name))[2])
);

drop policy if exists "storage_insert_room_member" on storage.objects;
create policy "storage_insert_room_member"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'slideroom-uploads'
  and (storage.foldername(name))[1] = 'rooms'
  and (storage.foldername(name))[3] = 'files'
  and name like 'rooms/%/files/%.pptx'
  and private.is_room_member((storage.foldername(name))[2])
);

drop policy if exists "storage_update_owner_or_manager" on storage.objects;
create policy "storage_update_owner_or_manager"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'slideroom-uploads'
  and exists (
    select 1
    from public.files
    where storage_key = storage.objects.name
      and (owner_user_id = (select auth.uid()) or private.can_manage_room(room_id))
  )
)
with check (
  bucket_id = 'slideroom-uploads'
  and exists (
    select 1
    from public.files
    where storage_key = storage.objects.name
      and (owner_user_id = (select auth.uid()) or private.can_manage_room(room_id))
  )
);

drop policy if exists "storage_delete_owner_or_manager" on storage.objects;
create policy "storage_delete_owner_or_manager"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'slideroom-uploads'
  and exists (
    select 1
    from public.files
    where storage_key = storage.objects.name
      and (owner_user_id = (select auth.uid()) or private.can_manage_room(room_id))
  )
);
