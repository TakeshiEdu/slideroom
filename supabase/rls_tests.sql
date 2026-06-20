-- SlideRoom RLS smoke tests for local or staging databases.
-- Do not run this file against production user data unless you have a backup and
-- understand that it creates and rolls back temporary auth users and room rows.

begin;

create temporary table rls_test_ids (
  owner_id uuid not null,
  member_id uuid not null,
  stranger_id uuid not null,
  room_id text not null
) on commit drop;

insert into rls_test_ids
values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'rls-test-room');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select owner_id, 'authenticated', 'authenticated', 'rls-owner@example.invalid', 'test', now(), now(), now()
from rls_test_ids
union all
select member_id, 'authenticated', 'authenticated', 'rls-member@example.invalid', 'test', now(), now(), now()
from rls_test_ids
union all
select stranger_id, 'authenticated', 'authenticated', 'rls-stranger@example.invalid', 'test', now(), now(), now()
from rls_test_ids;

insert into public.rooms (id, title, class_name, host_user_id, invite_code, invite_url)
select room_id, 'RLS Test Room', '', owner_id, 'RLSTEST', 'https://example.invalid/#/join/RLSTEST'
from rls_test_ids;

insert into public.room_members (id, room_id, user_id, display_name, role)
select 'rls-test-owner-member', room_id, owner_id, 'Owner', 'host'
from rls_test_ids
union all
select 'rls-test-member-member', room_id, member_id, 'Member', 'member'
from rls_test_ids;

insert into public.files (
  id,
  room_id,
  owner_user_id,
  owner_name,
  name,
  original_name,
  size_bytes,
  slide_count,
  storage_key
)
select
    'rls-test-file',
    room_id,
    member_id,
    'Member',
    'test.pptx',
    'test.pptx',
    1,
    1,
    'rooms/rls-test-room/files/rls-test-file.pptx'
from rls_test_ids;

grant select on rls_test_ids to authenticated;

set local role authenticated;

select set_config('request.jwt.claim.sub', member_id::text, true)
from rls_test_ids;

do $$
begin
  if (select count(*) from public.rooms where id = (select room_id from rls_test_ids)) <> 1 then
    raise exception 'member should read room';
  end if;
  if (select count(*) from public.files where id = 'rls-test-file') <> 1 then
    raise exception 'member should read file';
  end if;
  update public.room_members set role = 'admin' where id = 'rls-test-member-member';
  if found then
    raise exception 'member should not escalate role';
  end if;
end $$;

select set_config('request.jwt.claim.sub', stranger_id::text, true)
from rls_test_ids;

do $$
begin
  if (select count(*) from public.rooms where id = (select room_id from rls_test_ids)) <> 0 then
    raise exception 'stranger should not read room';
  end if;
  delete from public.files where id = 'rls-test-file';
  if found then
    raise exception 'stranger should not delete file';
  end if;
end $$;

select set_config('request.jwt.claim.sub', owner_id::text, true)
from rls_test_ids;

do $$
begin
  update public.rooms set title = 'RLS Test Room Updated' where id = (select room_id from rls_test_ids);
  if not found then
    raise exception 'owner should update room';
  end if;
end $$;

rollback;
