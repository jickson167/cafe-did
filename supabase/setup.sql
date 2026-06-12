-- Cafe DID / KDS용 Supabase 초기 설정
-- Supabase Dashboard → SQL Editor → New query → 붙여넣기 → Run

create table if not exists public.did_status (
  id integer primary key,
  data jsonb not null default '{"waiting":[],"ready":[]}'::jsonb
);

insert into public.did_status (id, data)
values (1, '{"waiting":[],"ready":[]}'::jsonb)
on conflict (id) do nothing;

alter table public.did_status enable row level security;

drop policy if exists "did_status_public_read" on public.did_status;
create policy "did_status_public_read"
on public.did_status
for select
to anon, authenticated
using (true);

drop policy if exists "did_status_public_update" on public.did_status;
create policy "did_status_public_update"
on public.did_status
for update
to anon, authenticated
using (true)
with check (true);

-- Realtime (웹 DID 실시간 갱신)
alter publication supabase_realtime add table public.did_status;
