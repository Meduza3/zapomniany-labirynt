create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists supabase_vault with schema vault;

create table public.rooms (
  code text primary key check (code ~ '^[A-Z2-9]{6}$'),
  revision bigint not null check (revision > 0),
  status text not null check (status in ('lobby', 'playing', 'finished')),
  host_id uuid not null,
  game jsonb,
  rules_version integer not null check (rules_version > 0),
  created_at timestamptz not null,
  last_activity timestamptz not null,
  check ((status = 'lobby') = (game is null))
);
create table public.members (
  room_code text not null references public.rooms(code) on delete cascade,
  player_id uuid not null,
  user_id uuid references auth.users(id) on delete cascade,
  seat integer not null check (seat between 0 and 3),
  name text not null check (char_length(name) between 1 and 24),
  color text not null check (color in ('green', 'yellow', 'blue', 'red')),
  is_bot boolean not null,
  primary key (room_code, player_id),
  unique (room_code, user_id),
  unique (room_code, seat),
  unique (room_code, color),
  check (is_bot = (user_id is null))
);
create table public.player_views (
  room_code text not null references public.rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null,
  view jsonb not null,
  primary key (room_code, user_id)
);
create table public.commands (
  actor_id uuid not null,
  request_id text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  room_code text not null references public.rooms(code) on delete cascade,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);
create index commands_actor_created on public.commands(actor_id, created_at desc);
create table public.bot_jobs (
  id bigint generated always as identity primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  expected_revision bigint not null,
  player_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done')),
  due_at timestamptz not null default (now() + interval '650 milliseconds'),
  leased_until timestamptz,
  lease_token uuid,
  attempts integer not null default 0,
  last_error text,
  unique (room_code, expected_revision)
);
create index bot_jobs_available on public.bot_jobs(status, due_at, leased_until) where status <> 'done';

alter table public.rooms enable row level security;
alter table public.members enable row level security;
alter table public.player_views enable row level security;
alter table public.commands enable row level security;
alter table public.bot_jobs enable row level security;
revoke all on public.rooms, public.members, public.player_views, public.commands, public.bot_jobs from public, anon, authenticated;
revoke all on sequence public.bot_jobs_id_seq from public, anon, authenticated;
grant all on public.rooms, public.members, public.player_views, public.commands, public.bot_jobs to service_role;
grant usage, select on sequence public.bot_jobs_id_seq to service_role;
grant select on public.player_views to authenticated;
create policy own_player_view on public.player_views for select to authenticated using ((select auth.uid()) = user_id);
alter publication supabase_realtime add table public.player_views;

create function public.load_cloud_room(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'code', r.code, 'revision', r.revision, 'status', r.status, 'hostId', r.host_id,
    'game', r.game, 'rulesVersion', r.rules_version,
    'createdAt', floor(extract(epoch from r.created_at) * 1000),
    'lastActivity', floor(extract(epoch from r.last_activity) * 1000),
    'players', coalesce((select jsonb_agg(jsonb_build_object('id', m.player_id, 'userId', m.user_id, 'seat', m.seat, 'name', m.name, 'color', m.color, 'isBot', m.is_bot) order by m.seat) from public.members m where m.room_code = r.code), '[]'::jsonb)
  ) from public.rooms r where r.code = p_code;
$$;

create function public.commit_cloud_room(
  p_room jsonb, p_expected_revision bigint, p_actor_id uuid, p_request_id text,
  p_request_hash text, p_response jsonb, p_views jsonb,
  p_bot_job_id bigint default null, p_lease_token uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := p_room->>'code';
  v_revision bigint := (p_room->>'revision')::bigint;
  v_current bigint;
  v_receipt public.commands%rowtype;
  v_member jsonb;
  v_view jsonb;
  v_player uuid;
  v_host boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text, 0));
  select * into v_receipt from public.commands where actor_id = p_actor_id and request_id = p_request_id;
  if found then
    if v_receipt.request_hash <> p_request_hash then raise exception using errcode = 'PT409', message = 'Identyfikator żądania został już użyty dla innych danych.'; end if;
    return v_receipt.response;
  end if;
  if p_bot_job_id is null and (select count(*) from public.commands where actor_id = p_actor_id and created_at > now() - interval '1 minute') >= 120 then
    raise exception using errcode = 'PT429', message = 'Zbyt wiele żądań. Spróbuj za minutę.';
  end if;
  if p_bot_job_id is not null then
    perform 1 from public.bot_jobs where id = p_bot_job_id and room_code = v_code and expected_revision = p_expected_revision and lease_token = p_lease_token and status = 'running' and leased_until > now() for update;
    if not found then raise exception using errcode = 'PT409', message = 'Wygasła rezerwacja ruchu bota.'; end if;
  end if;
  if p_expected_revision = 0 then
    perform pg_advisory_xact_lock(hashtextextended('cloud-room-create', 0));
    if (select count(*) from public.rooms) >= 500 then raise exception using errcode = 'PT429', message = 'Limit pokoi został osiągnięty.'; end if;
    if (select count(*) from public.members where user_id = p_actor_id and seat = 0) >= 10 then raise exception using errcode = 'PT429', message = 'Możesz utworzyć najwyżej dziesięć pokoi.'; end if;
    if v_revision <> 1 then raise exception using errcode = 'PT400', message = 'Nieprawidłowa wersja pokoju.'; end if;
    insert into public.rooms(code, revision, status, host_id, game, rules_version, created_at, last_activity)
    values(v_code, v_revision, p_room->>'status', (p_room->>'hostId')::uuid, nullif(p_room->'game', 'null'::jsonb), (p_room->>'rulesVersion')::integer, to_timestamp((p_room->>'createdAt')::double precision / 1000), to_timestamp((p_room->>'lastActivity')::double precision / 1000));
  else
    select revision into v_current from public.rooms where code = v_code for update;
    if not found then raise exception using errcode = 'PT404', message = 'Nie znaleziono pokoju.'; end if;
    if v_current <> p_expected_revision then raise exception using errcode = 'PT409', message = 'Plansza zmieniła się. Odśwież stan i wykonaj ruch ponownie.'; end if;
    if v_revision not in (p_expected_revision, p_expected_revision + 1) then raise exception using errcode = 'PT400', message = 'Nieprawidłowa wersja pokoju.'; end if;
    if v_revision = p_expected_revision then
      insert into public.commands(actor_id, request_id, request_hash, room_code, response) values(p_actor_id, p_request_id, p_request_hash, v_code, p_response);
      return p_response;
    end if;
    update public.rooms set revision = v_revision, status = p_room->>'status', host_id = (p_room->>'hostId')::uuid, game = nullif(p_room->'game', 'null'::jsonb), rules_version = (p_room->>'rulesVersion')::integer, last_activity = to_timestamp((p_room->>'lastActivity')::double precision / 1000) where code = v_code;
  end if;
  if jsonb_array_length(p_room->'players') not between 1 and 4 then raise exception using errcode = 'PT400', message = 'Nieprawidłowa liczba graczy.'; end if;
  delete from public.members where room_code = v_code;
  v_host := false;
  for v_member in select value from jsonb_array_elements(p_room->'players') loop
    insert into public.members(room_code, player_id, user_id, seat, name, color, is_bot)
    values(v_code, (v_member->>'id')::uuid, (v_member->>'userId')::uuid, (v_member->>'seat')::integer, v_member->>'name', v_member->>'color', (v_member->>'isBot')::boolean);
    if v_member->>'id' = p_room->>'hostId' and not (v_member->>'isBot')::boolean then v_host := true; end if;
  end loop;
  if not v_host then raise exception using errcode = 'PT400', message = 'Gospodarz musi być człowiekiem.'; end if;
  if jsonb_array_length(p_views) <> (select count(*) from public.members where room_code = v_code and not is_bot) then raise exception using errcode = 'PT400', message = 'Niepełne widoki graczy.'; end if;
  delete from public.player_views v where room_code = v_code and not exists(select 1 from public.members m where m.room_code = v_code and m.user_id = v.user_id);
  for v_view in select value from jsonb_array_elements(p_views) loop
    if v_view->>'room_code' <> v_code or (v_view->>'revision')::bigint <> v_revision or not exists(select 1 from public.members where room_code = v_code and user_id = (v_view->>'user_id')::uuid and not is_bot) then raise exception using errcode = 'PT400', message = 'Nieprawidłowy widok gracza.'; end if;
    insert into public.player_views(room_code, user_id, revision, view) values(v_code, (v_view->>'user_id')::uuid, v_revision, v_view->'view')
    on conflict (room_code, user_id) do update set revision = excluded.revision, view = excluded.view;
  end loop;
  insert into public.commands(actor_id, request_id, request_hash, room_code, response) values(p_actor_id, p_request_id, p_request_hash, v_code, p_response);
  update public.bot_jobs set status = 'done', leased_until = null, lease_token = null where room_code = v_code and expected_revision <= p_expected_revision and status <> 'done';
  if p_room->>'status' = 'playing' then
    v_player := (p_room->'game'->>'currentPlayerId')::uuid;
    if exists(select 1 from public.members where room_code = v_code and player_id = v_player and is_bot) then
      insert into public.bot_jobs(room_code, expected_revision, player_id) values(v_code, v_revision, v_player) on conflict (room_code, expected_revision) do nothing;
    end if;
  end if;
  return p_response;
end;
$$;

create function public.claim_cloud_bot_job(p_room_code text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_job public.bot_jobs%rowtype;
begin
  select * into v_job from public.bot_jobs where (p_room_code is null or room_code = p_room_code) and ((status = 'pending' and due_at <= now()) or (status = 'running' and leased_until <= now())) order by due_at, id for update skip locked limit 1;
  if not found then return null; end if;
  update public.bot_jobs set status = 'running', leased_until = now() + interval '30 seconds', lease_token = gen_random_uuid(), attempts = attempts + 1 where id = v_job.id returning * into v_job;
  return to_jsonb(v_job);
end;
$$;

create function public.release_cloud_bot_job(p_job_id bigint, p_lease_token uuid, p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update public.bot_jobs set status = case when p_error is null then 'done' else 'pending' end, due_at = now() + interval '5 seconds', leased_until = null, lease_token = null, last_error = left(p_error, 500) where id = p_job_id and lease_token = p_lease_token and status = 'running';
$$;

create function public.wake_cloud_bot_worker(p_room_code text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text; v_request bigint;
begin
  if not exists(select 1 from public.bot_jobs where (p_room_code is null or room_code = p_room_code) and ((status = 'pending' and (p_room_code is not null or due_at <= now())) or (status = 'running' and leased_until <= now()))) then return null; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'labirynt_project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'labirynt_bot_secret';
  if v_url is null or v_secret is null then return null; end if;
  select net.http_post(url := rtrim(v_url, '/') || '/functions/v1/bot-worker', headers := jsonb_build_object('Content-Type', 'application/json', 'x-bot-secret', v_secret), body := case when p_room_code is null then '{}'::jsonb else jsonb_build_object('roomCode', p_room_code) end, timeout_milliseconds := 10000) into v_request;
  return v_request;
end;
$$;

create function public.wake_cloud_bot_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.wake_cloud_bot_worker(new.room_code);
  return new;
end;
$$;
create trigger bot_job_wakeup after insert on public.bot_jobs for each row execute function public.wake_cloud_bot_trigger();

create function public.configure_cloud_runtime(p_project_url text, p_bot_secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_project_url !~ '^https?://[^[:space:]]+$' or char_length(p_bot_secret) < 32 then raise exception using errcode = 'PT400', message = 'Nieprawidłowa konfiguracja bota.'; end if;
  select id into v_id from vault.secrets where name = 'labirynt_project_url';
  if v_id is null then perform vault.create_secret(rtrim(p_project_url, '/'), 'labirynt_project_url'); else perform vault.update_secret(v_id, rtrim(p_project_url, '/')); end if;
  select id into v_id from vault.secrets where name = 'labirynt_bot_secret';
  if v_id is null then perform vault.create_secret(p_bot_secret, 'labirynt_bot_secret'); else perform vault.update_secret(v_id, p_bot_secret); end if;
  perform cron.schedule('labirynt-bot-recovery', '* * * * *', 'select public.wake_cloud_bot_worker();');
  perform public.wake_cloud_bot_worker();
end;
$$;

revoke all on function public.load_cloud_room(text), public.commit_cloud_room(jsonb, bigint, uuid, text, text, jsonb, jsonb, bigint, uuid), public.claim_cloud_bot_job(text), public.release_cloud_bot_job(bigint, uuid, text), public.wake_cloud_bot_worker(text), public.wake_cloud_bot_trigger(), public.configure_cloud_runtime(text, text) from public, anon, authenticated;
grant execute on function public.load_cloud_room(text), public.commit_cloud_room(jsonb, bigint, uuid, text, text, jsonb, jsonb, bigint, uuid), public.claim_cloud_bot_job(text), public.release_cloud_bot_job(bigint, uuid, text), public.wake_cloud_bot_worker(text), public.configure_cloud_runtime(text, text) to service_role;
