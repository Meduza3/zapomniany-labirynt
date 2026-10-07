create table public.game_results (
  room_code text not null check (room_code ~ '^[A-Z2-9]{6}$'),
  room_created_at timestamptz not null,
  finished_at timestamptz not null,
  turn_count integer not null check (turn_count > 0),
  players jsonb not null check (jsonb_typeof(players) = 'array' and jsonb_array_length(players) = 4),
  starter_id uuid not null,
  winner_id uuid not null,
  first_player_won boolean not null,
  primary key (room_code, room_created_at),
  check (first_player_won = (starter_id = winner_id)),
  check (players->0->>'id' = starter_id::text)
);
create index game_results_finished_at on public.game_results(finished_at desc);
alter table public.game_results enable row level security;
revoke all on public.game_results from public, anon, authenticated;
grant all on public.game_results to service_role;

create function public.record_game_result(p_room public.rooms) returns void
language sql security definer set search_path = '' as $$
  insert into public.game_results(room_code, room_created_at, finished_at, turn_count, players, starter_id, winner_id, first_player_won)
  select (p_room).code, (p_room).created_at, (p_room).last_activity, ((p_room).game->>'turnNumber')::integer,
    (select jsonb_agg(jsonb_build_object(
      'id', p.player->>'id', 'name', p.player->>'name', 'color', p.player->>'color',
      'isBot', coalesce(m.is_bot, false), 'flowers', p.player->'flowers'
    ) order by p.seat)
    from jsonb_array_elements((p_room).game->'players') with ordinality as p(player, seat)
    left join public.members m on m.room_code = (p_room).code and m.player_id = (p.player->>'id')::uuid),
    ((p_room).game->'players'->0->>'id')::uuid, ((p_room).game->>'winnerId')::uuid,
    (p_room).game->'players'->0->>'id' = (p_room).game->>'winnerId'
  where (p_room).status = 'finished' and (p_room).game->>'status' = 'finished'
  on conflict (room_code, room_created_at) do nothing;
$$;

create function public.capture_completed_game_result() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.record_game_result(new);
  return new;
end;
$$;

revoke all on function public.record_game_result(public.rooms), public.capture_completed_game_result() from public, anon, authenticated;
grant execute on function public.record_game_result(public.rooms) to service_role;

create constraint trigger capture_completed_game_result
  after insert or update on public.rooms
  deferrable initially deferred
  for each row when (new.status = 'finished')
  execute function public.capture_completed_game_result();

do $$
declare saved_room public.rooms%rowtype;
begin
  for saved_room in select * from public.rooms where status = 'finished' loop
    perform public.record_game_result(saved_room);
  end loop;
end;
$$;
