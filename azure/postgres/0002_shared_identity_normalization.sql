-- Shared identity normalization for MAIN/CN/EU/US/KR.
-- Run ONCE against the shared cosmetic_compliance database.
-- The migration is transactional: if any foreign-key reassignment conflicts,
-- the whole migration rolls back instead of leaving partially merged users.

begin;

create table if not exists public.app_user_identities (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  identity_provider text not null,
  identity_subject text not null,
  email_snapshot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (identity_provider, identity_subject)
);

create index if not exists app_user_identities_user_idx
  on public.app_user_identities(app_user_id);
create index if not exists app_user_identities_email_idx
  on public.app_user_identities(lower(email_snapshot));

-- Pick one canonical account per email. Prefer an active, enabled account with
-- the most complete profile, then the oldest record for deterministic results.
create temporary table _user_merge_map (
  old_id uuid primary key,
  canonical_id uuid not null
) on commit drop;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by lower(email)
      order by
        case when account_status = 'active' then 0 else 1 end,
        case when disabled = false then 0 else 1 end,
        (
          case when full_name is not null then 1 else 0 end +
          case when company_name is not null then 1 else 0 end +
          case when business_registration_number is not null then 1 else 0 end +
          case when job_title is not null then 1 else 0 end +
          case when phone is not null then 1 else 0 end
        ) desc,
        created_at asc,
        id asc
    ) as canonical_id,
    count(*) over (partition by lower(email)) as duplicate_count
  from public.app_users
  where email is not null and btrim(email) <> ''
)
insert into _user_merge_map(old_id, canonical_id)
select id, canonical_id
from ranked
where duplicate_count > 1 and id <> canonical_id;

-- Preserve every External ID subject before duplicate app_users rows are merged.
insert into public.app_user_identities(
  app_user_id, identity_provider, identity_subject, email_snapshot, updated_at
)
select
  coalesce(m.canonical_id, u.id),
  u.identity_provider,
  u.identity_subject,
  lower(u.email),
  now()
from public.app_users u
left join _user_merge_map m on m.old_id = u.id
where u.identity_provider is not null
  and u.identity_subject is not null
  and btrim(u.identity_provider) <> ''
  and btrim(u.identity_subject) <> ''
on conflict(identity_provider, identity_subject) do update
set app_user_id = excluded.app_user_id,
    email_snapshot = excluded.email_snapshot,
    updated_at = now();

-- Merge role/status/profile information into the selected canonical row.
update public.app_users c
set role = case
      when exists (
        select 1 from public.app_users u
        where (u.id = c.id or u.id in (select old_id from _user_merge_map where canonical_id = c.id))
          and u.role::text = 'admin'
      ) then 'admin'::app_role
      when exists (
        select 1 from public.app_users u
        where (u.id = c.id or u.id in (select old_id from _user_merge_map where canonical_id = c.id))
          and u.role::text = 'ra'
      ) then 'ra'::app_role
      else c.role
    end,
    account_status = case
      when exists (
        select 1 from public.app_users u
        where (u.id = c.id or u.id in (select old_id from _user_merge_map where canonical_id = c.id))
          and u.account_status = 'active'
      ) then 'active'
      else c.account_status
    end,
    disabled = case
      when exists (
        select 1 from public.app_users u
        where (u.id = c.id or u.id in (select old_id from _user_merge_map where canonical_id = c.id))
          and u.disabled = false
      ) then false
      else c.disabled
    end,
    full_name = coalesce(c.full_name, (
      select u.full_name from public.app_users u
      where u.id in (select old_id from _user_merge_map where canonical_id = c.id)
        and u.full_name is not null
      order by u.created_at asc limit 1
    )),
    company_name = coalesce(c.company_name, (
      select u.company_name from public.app_users u
      where u.id in (select old_id from _user_merge_map where canonical_id = c.id)
        and u.company_name is not null
      order by u.created_at asc limit 1
    )),
    business_registration_number = coalesce(c.business_registration_number, (
      select u.business_registration_number from public.app_users u
      where u.id in (select old_id from _user_merge_map where canonical_id = c.id)
        and u.business_registration_number is not null
      order by u.created_at asc limit 1
    )),
    job_title = coalesce(c.job_title, (
      select u.job_title from public.app_users u
      where u.id in (select old_id from _user_merge_map where canonical_id = c.id)
        and u.job_title is not null
      order by u.created_at asc limit 1
    )),
    phone = coalesce(c.phone, (
      select u.phone from public.app_users u
      where u.id in (select old_id from _user_merge_map where canonical_id = c.id)
        and u.phone is not null
      order by u.created_at asc limit 1
    )),
    updated_at = now()
where c.id in (select distinct canonical_id from _user_merge_map);

-- Move every single-column FK that references public.app_users(id) to the
-- canonical account. This includes CN/EU/US/KR business tables and self-FKs.
do $$
declare
  r record;
begin
  for r in
    select
      ns.nspname as schema_name,
      cls.relname as table_name,
      att.attname as column_name
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    join pg_attribute att
      on att.attrelid = con.conrelid
     and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = 'public.app_users'::regclass
      and array_length(con.conkey, 1) = 1
      and array_length(con.confkey, 1) = 1
  loop
    execute format(
      'update %I.%I t set %I = m.canonical_id from _user_merge_map m where t.%I = m.old_id',
      r.schema_name, r.table_name, r.column_name, r.column_name
    );
  end loop;
exception
  when unique_violation then
    raise exception 'Identity merge stopped because a dependent table has a uniqueness conflict. No changes were committed.';
end $$;

-- Remove duplicate user rows only after all FK references have been moved.
delete from public.app_users u
using _user_merge_map m
where u.id = m.old_id;

-- One portal account per email from now on; multiple platform subjects live in
-- app_user_identities instead of creating multiple app_users rows.
create unique index if not exists app_users_email_unique_idx
  on public.app_users(lower(email));

commit;

-- Verification queries (safe to run after the migration):
-- select lower(email), count(*) from public.app_users group by lower(email) having count(*) > 1;
-- select u.email, i.identity_provider, i.identity_subject
--   from public.app_users u join public.app_user_identities i on i.app_user_id=u.id
--  order by lower(u.email), i.created_at;
