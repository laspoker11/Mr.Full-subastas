-- ============================================================
-- CONCURSO: torneo de cultura general con duelos 1 vs 1 de
-- eliminación directa. Cómo usar: pega TODO este archivo en el
-- SQL Editor de Supabase y dale Run. Segura de correr aunque la
-- vuelvas a correr después.
-- ============================================================

-- 1) CATEGORÍAS DE PREGUNTAS -------------------------------------------
create table if not exists public.trivia_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.trivia_categories enable row level security;

drop policy if exists "cualquiera puede ver categorias de concurso" on public.trivia_categories;
create policy "cualquiera puede ver categorias de concurso"
  on public.trivia_categories for select
  using (true);

-- 2) BANCO DE PREGUNTAS ---------------------------------------------------
create table if not exists public.trivia_questions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.trivia_categories(id),
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_option text not null check (correct_option in ('a', 'b', 'c', 'd')),
  difficulty text not null default 'media' check (difficulty in ('facil', 'media', 'dificil')),
  -- pending = recién importada, todavía nadie la revisó
  -- approved = Luis la aprobó, ya se puede usar en un duelo real
  -- rejected = Luis la descartó (mal escrita, respuesta dudosa, etc.)
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.trivia_questions enable row level security;

-- A propósito NO hay ninguna política de SELECT aquí: ni "authenticated" ni
-- "anon" pueden leer esta tabla directamente desde el navegador, porque el
-- texto de la pregunta viene pegado con la respuesta correcta (correct_option).
-- Solo las funciones de más abajo (que corren como "security definer", es
-- decir, con permiso para saltarse esta regla) pueden leerla — y solo
-- get_my_duel_question() la entrega al jugador, siempre sin correct_option.

-- 3) CONCURSOS -------------------------------------------------------
create table if not exists public.trivia_contests (
  id uuid primary key default gen_random_uuid(),
  display_id bigserial unique,
  title text not null,
  description text default '',
  category_id uuid references public.trivia_categories(id),
  -- draft = recién creado, todavía nadie se puede inscribir
  -- signups_open = se puede uno inscribir
  -- in_progress = ya arrancó la ronda 1, las inscripciones quedaron cerradas
  -- closed = terminó, ya hay ganador (o no quedó ninguno)
  -- cancelled = Luis lo canceló a mano (reservado para más adelante)
  status text not null default 'draft' check (status in ('draft', 'signups_open', 'in_progress', 'closed', 'cancelled')),
  winner_user_id uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.trivia_contests enable row level security;

drop policy if exists "cualquiera puede ver los concursos" on public.trivia_contests;
create policy "cualquiera puede ver los concursos"
  on public.trivia_contests for select
  using (true);

-- 4) RONDAS DE CADA CONCURSO ---------------------------------------------
create table if not exists public.trivia_contest_rounds (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.trivia_contests(id) on delete cascade,
  round_number integer not null,
  round_name text not null,             -- ej "Octavos de final", calculado solo
  scheduled_start timestamptz not null, -- hora exacta en que arranca esta ronda
  window_minutes integer not null check (window_minutes > 0),        -- cuánto dura la ventana
  per_question_seconds integer not null check (per_question_seconds > 0), -- tiempo por pregunta
  advance_delay_minutes integer not null default 5 check (advance_delay_minutes >= 0), -- minutos hasta que arranca sola la siguiente
  prize_description text default '',
  status text not null default 'scheduled' check (status in ('scheduled', 'open', 'closed')),
  window_closed boolean not null default false, -- true = ya se acabó el tiempo de responder (aunque falten desempates por resolver)
  opened_at timestamptz,
  closed_at timestamptz,
  unique (contest_id, round_number)
);

alter table public.trivia_contest_rounds enable row level security;

drop policy if exists "cualquiera puede ver las rondas del concurso" on public.trivia_contest_rounds;
create policy "cualquiera puede ver las rondas del concurso"
  on public.trivia_contest_rounds for select
  using (true);

-- 5) INSCRIPCIONES ------------------------------------------------------
create table if not exists public.trivia_signups (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.trivia_contests(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  status text not null default 'inscrito' check (status in ('inscrito', 'eliminado', 'ganador')),
  created_at timestamptz not null default now(),
  unique (contest_id, user_id)
);

alter table public.trivia_signups enable row level security;

drop policy if exists "el propio inscrito o un admin puede ver su inscripcion a concurso" on public.trivia_signups;
create policy "el propio inscrito o un admin puede ver su inscripcion a concurso"
  on public.trivia_signups for select
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- 6) PARTICIPACIÓN (para dar el +1 punto una sola vez por concurso) --------
create table if not exists public.trivia_participation (
  contest_id uuid not null references public.trivia_contests(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (contest_id, user_id)
);

alter table public.trivia_participation enable row level security;

drop policy if exists "el propio usuario o un admin puede ver su participacion en concurso" on public.trivia_participation;
create policy "el propio usuario o un admin puede ver su participacion en concurso"
  on public.trivia_participation for select
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- 7) DUELOS 1 VS 1 --------------------------------------------------------
create table if not exists public.trivia_duels (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.trivia_contest_rounds(id) on delete cascade,
  player1_id uuid references public.profiles(id),
  player2_id uuid references public.profiles(id), -- null = pase automático (bye)
  status text not null default 'pending' check (status in ('pending', 'tiebreak', 'closed')),
  winner_id uuid references public.profiles(id),  -- null si los dos quedaron eliminados
  is_bye boolean not null default false,
  p1_correct_count integer not null default 0,
  p2_correct_count integer not null default 0,
  p1_total_ms bigint not null default 0,
  p2_total_ms bigint not null default 0,
  tiebreak_round integer not null default 0,     -- cuántas preguntas de desempate ya se usaron
  tiebreak_deadline timestamptz,
  created_at timestamptz not null default now()
);

alter table public.trivia_duels enable row level security;

drop policy if exists "cualquiera puede ver los duelos" on public.trivia_duels;
create policy "cualquiera puede ver los duelos"
  on public.trivia_duels for select
  using (true);
-- Es seguro que esto sea público: un duelo solo guarda quién compitió contra
-- quién, puntajes y tiempos — nunca el texto de la pregunta ni la respuesta.

-- 8) QUÉ PREGUNTA LE TOCA A CADA DUELO (nunca compartida entre parejas) ----
create table if not exists public.trivia_duel_questions (
  id uuid primary key default gen_random_uuid(),
  duel_id uuid not null references public.trivia_duels(id) on delete cascade,
  question_id uuid not null references public.trivia_questions(id),
  -- slots 1-5 = las 5 preguntas normales del duelo
  -- slots 6-10 = preguntas de desempate, se van agregando solo si hacen falta
  slot integer not null check (slot between 1 and 10),
  created_at timestamptz not null default now(),
  unique (duel_id, slot)
);

alter table public.trivia_duel_questions enable row level security;
-- Sin SELECT para clientes: cruzar duelo + pregunta revelaría cuál pregunta
-- le toca a cada quien antes de tiempo. Se entrega solo por get_my_duel_question().

-- 9) RESPUESTAS DE CADA JUGADOR -------------------------------------------
create table if not exists public.trivia_duel_answers (
  id uuid primary key default gen_random_uuid(),
  duel_id uuid not null references public.trivia_duels(id) on delete cascade,
  duel_question_id uuid not null references public.trivia_duel_questions(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  -- se guarda apenas el jugador PIDE ver la pregunta, para medir el tiempo
  -- real en el servidor (nunca confiando en un tiempo que mande el navegador)
  presented_at timestamptz,
  selected_option text check (selected_option in ('a', 'b', 'c', 'd')),
  is_correct boolean,
  response_ms integer,
  answered_at timestamptz,
  unique (duel_question_id, user_id)
);

alter table public.trivia_duel_answers enable row level security;

drop policy if exists "el propio jugador o un admin puede ver su respuesta" on public.trivia_duel_answers;
create policy "el propio jugador o un admin puede ver su respuesta"
  on public.trivia_duel_answers for select
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

-- 10) FUNCIONES DE ADMINISTRACIÓN DEL BANCO DE PREGUNTAS -------------------

-- Crear/reusar una categoría de preguntas (solo admin)
create or replace function public.create_trivia_category(p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_id uuid;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede crear categorías'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'El nombre de la categoría no puede estar vacío'; end if;

  select id into v_id from public.trivia_categories where lower(name) = lower(trim(p_name));
  if v_id is not null then return v_id; end if;

  begin
    insert into public.trivia_categories (name, created_by) values (trim(p_name), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.trivia_categories where lower(name) = lower(trim(p_name));
  end;
  return v_id;
end;
$$;

-- Importar un lote de preguntas generadas con IA (solo admin). Recibe un
-- arreglo JSON, ej:
-- [{"question_text":"...", "option_a":"...", "option_b":"...", "option_c":"...",
--   "option_d":"...", "correct_option":"b", "category":"Historia", "difficulty":"media"}, ...]
-- Todas quedan en estado "pending" — no se usan en ningún duelo hasta que
-- alguien las apruebe una por una en el panel admin.
create or replace function public.bulk_import_trivia_questions(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_row jsonb;
  v_count integer := 0;
  v_category_id uuid;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede importar preguntas'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'El formato debe ser una lista de preguntas'; end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_category_id := null;
    if v_row ? 'category' and coalesce(trim(v_row->>'category'), '') <> '' then
      v_category_id := public.create_trivia_category(v_row->>'category');
    end if;

    insert into public.trivia_questions
      (category_id, question_text, option_a, option_b, option_c, option_d, correct_option, difficulty, created_by, status)
    values (
      v_category_id,
      v_row->>'question_text',
      v_row->>'option_a', v_row->>'option_b', v_row->>'option_c', v_row->>'option_d',
      lower(v_row->>'correct_option'),
      coalesce(v_row->>'difficulty', 'media'),
      auth.uid(),
      'pending'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Aprobar o rechazar una pregunta pendiente (solo admin)
create or replace function public.review_trivia_question(p_question_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede revisar preguntas'; end if;

  update public.trivia_questions
    set status = case when p_approve then 'approved' else 'rejected' end,
        reject_reason = case when p_approve then null else p_reason end
    where id = p_question_id;
end;
$$;

-- 11) FUNCIONES DE CONCURSOS Y RONDAS -------------------------------------

-- Nombre de ronda según cuánta gente entra a competir en ella
create or replace function public._trivia_round_name(p_count integer)
returns text
language sql immutable as $$
  select case
    when p_count <= 2 then 'Final'
    when p_count <= 4 then 'Semifinal'
    when p_count <= 8 then 'Cuartos de final'
    when p_count <= 16 then 'Octavos de final'
    when p_count <= 32 then 'Dieciseisavos de final'
    else 'Ronda de ' || p_count
  end;
$$;

-- Crear un concurso (solo admin)
create or replace function public.create_trivia_contest(p_title text, p_description text default '', p_category_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_id uuid;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede crear concursos'; end if;
  if p_title is null or trim(p_title) = '' then raise exception 'Ponle un nombre al concurso'; end if;

  insert into public.trivia_contests (title, description, category_id, created_by)
  values (trim(p_title), coalesce(p_description, ''), p_category_id, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Abrir inscripciones de un concurso (solo admin)
create or replace function public.open_trivia_signups(p_contest_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean; v_status text;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede abrir inscripciones'; end if;

  select status into v_status from public.trivia_contests where id = p_contest_id for update;
  if v_status is null then raise exception 'Concurso no encontrado'; end if;
  if v_status <> 'draft' then raise exception 'Este concurso ya no está en borrador'; end if;

  update public.trivia_contests set status = 'signups_open' where id = p_contest_id;
end;
$$;

-- Inscribirse a un concurso (cualquier usuario autenticado, sobre sí mismo)
create or replace function public.trivia_signup(p_contest_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_contest public.trivia_contests%rowtype;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para poder inscribirte'; end if;

  select * into v_contest from public.trivia_contests where id = p_contest_id for update;
  if v_contest is null then raise exception 'Concurso no encontrado'; end if;
  if v_contest.status <> 'signups_open' then raise exception 'Las inscripciones de este concurso no están abiertas'; end if;

  begin
    insert into public.trivia_signups (contest_id, user_id) values (p_contest_id, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya estás inscrito en este concurso';
  end;

  return v_id;
end;
$$;

-- Programar una ronda (solo admin). Para la ronda 1 exige al menos 2
-- inscritos, y de paso cierra las inscripciones (el concurso pasa a
-- "in_progress"). Para las rondas siguientes calcula el nombre solo,
-- según cuánta gente ganó la ronda anterior.
create or replace function public.create_trivia_round(
  p_contest_id uuid, p_scheduled_start timestamptz, p_window_minutes integer,
  p_per_question_seconds integer, p_advance_delay_minutes integer, p_prize_description text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_contest public.trivia_contests%rowtype;
  v_round_number integer;
  v_count integer;
  v_prev_round_id uuid;
  v_name text;
  v_id uuid;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede programar rondas'; end if;

  select * into v_contest from public.trivia_contests where id = p_contest_id for update;
  if v_contest is null then raise exception 'Concurso no encontrado'; end if;
  if p_window_minutes is null or p_window_minutes <= 0 then raise exception 'La duración de la ronda debe ser mayor a 0'; end if;
  if p_per_question_seconds is null or p_per_question_seconds <= 0 then raise exception 'El tiempo por pregunta debe ser mayor a 0'; end if;
  if p_advance_delay_minutes is null or p_advance_delay_minutes < 0 then raise exception 'Los minutos para la siguiente ronda no pueden ser negativos'; end if;

  select coalesce(max(round_number), 0) + 1 into v_round_number from public.trivia_contest_rounds where contest_id = p_contest_id;

  if v_round_number = 1 then
    select count(*) into v_count from public.trivia_signups where contest_id = p_contest_id and status = 'inscrito';
    if v_count < 2 then raise exception 'Se necesitan al menos 2 inscritos para arrancar el concurso'; end if;
  else
    select id into v_prev_round_id from public.trivia_contest_rounds where contest_id = p_contest_id and round_number = v_round_number - 1;
    select count(*) into v_count from public.trivia_duels where round_id = v_prev_round_id and winner_id is not null;
  end if;

  v_name := public._trivia_round_name(v_count);

  insert into public.trivia_contest_rounds
    (contest_id, round_number, round_name, scheduled_start, window_minutes, per_question_seconds, advance_delay_minutes, prize_description)
  values (p_contest_id, v_round_number, v_name, p_scheduled_start, p_window_minutes, p_per_question_seconds, p_advance_delay_minutes, coalesce(p_prize_description, ''))
  returning id into v_id;

  if v_round_number = 1 and v_contest.status = 'signups_open' then
    update public.trivia_contests set status = 'in_progress' where id = p_contest_id;
  end if;

  return v_id;
end;
$$;

-- 12) JUGAR UN DUELO -------------------------------------------------------

-- Devuelve la pregunta que le toca al jugador en el slot indicado (nunca la
-- respuesta correcta), y solo si ya respondió la anterior. La primera vez
-- que se pide, se guarda "presented_at" para medir el tiempo real después.
create or replace function public.get_my_duel_question(p_duel_id uuid, p_slot integer)
returns table (question_text text, option_a text, option_b text, option_c text, option_d text, seconds_limit integer, deadline timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_duel public.trivia_duels%rowtype;
  v_round public.trivia_contest_rounds%rowtype;
  v_dq public.trivia_duel_questions%rowtype;
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;

  select * into v_duel from public.trivia_duels where id = p_duel_id;
  if v_duel is null then raise exception 'Duelo no encontrado'; end if;
  if auth.uid() not in (v_duel.player1_id, v_duel.player2_id) then
    raise exception 'Este duelo no te pertenece';
  end if;
  if v_duel.status not in ('pending', 'tiebreak') then
    raise exception 'Este duelo ya terminó';
  end if;

  select * into v_dq from public.trivia_duel_questions where duel_id = p_duel_id and slot = p_slot;
  if v_dq is null then raise exception 'Esa pregunta todavía no está disponible'; end if;

  if p_slot > 1 and p_slot <= 5 and not exists (
    select 1 from public.trivia_duel_answers a
    join public.trivia_duel_questions dq on dq.id = a.duel_question_id
    where dq.duel_id = p_duel_id and dq.slot = p_slot - 1 and a.user_id = auth.uid() and a.selected_option is not null
  ) then
    raise exception 'Primero responde la pregunta anterior';
  end if;

  select * into v_round from public.trivia_contest_rounds where id = v_duel.round_id;

  insert into public.trivia_duel_answers (duel_id, duel_question_id, user_id, presented_at)
  values (p_duel_id, v_dq.id, auth.uid(), now())
  on conflict (duel_question_id, user_id) do nothing;

  return query
    select q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
           v_round.per_question_seconds,
           a.presented_at + (v_round.per_question_seconds || ' seconds')::interval
    from public.trivia_questions q
    join public.trivia_duel_answers a on a.duel_question_id = v_dq.id and a.user_id = auth.uid()
    where q.id = v_dq.question_id;
end;
$$;

-- Registra la respuesta del jugador. El tiempo de respuesta se mide en el
-- servidor (ahora - presented_at), nunca confiando en lo que mande el navegador.
create or replace function public.submit_trivia_answer(p_duel_question_id uuid, p_selected_option text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_dq public.trivia_duel_questions%rowtype;
  v_duel public.trivia_duels%rowtype;
  v_round public.trivia_contest_rounds%rowtype;
  v_answer public.trivia_duel_answers%rowtype;
  v_correct text;
  v_is_correct boolean;
  v_ms integer;
  v_new_rows integer;
  v_contest_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  if p_selected_option not in ('a', 'b', 'c', 'd') then raise exception 'Opción inválida'; end if;

  select * into v_dq from public.trivia_duel_questions where id = p_duel_question_id;
  if v_dq is null then raise exception 'Pregunta no encontrada'; end if;

  select * into v_duel from public.trivia_duels where id = v_dq.duel_id for update;
  if auth.uid() not in (v_duel.player1_id, v_duel.player2_id) then raise exception 'Este duelo no te pertenece'; end if;
  if v_duel.status not in ('pending', 'tiebreak') then raise exception 'Este duelo ya terminó'; end if;

  select * into v_answer from public.trivia_duel_answers where duel_question_id = p_duel_question_id and user_id = auth.uid() for update;
  if v_answer is null or v_answer.presented_at is null then raise exception 'Primero debes ver la pregunta'; end if;
  if v_answer.selected_option is not null then raise exception 'Ya respondiste esta pregunta'; end if;

  select * into v_round from public.trivia_contest_rounds where id = v_duel.round_id;
  v_ms := greatest(0, round(extract(epoch from (now() - v_answer.presented_at)) * 1000))::integer;

  select correct_option into v_correct from public.trivia_questions where id = v_dq.question_id;
  -- un poco de margen (2 seg) para que la latencia normal de internet no cuente como "se le pasó el tiempo"
  v_is_correct := (p_selected_option = v_correct) and (v_ms <= (v_round.per_question_seconds * 1000 + 2000));

  update public.trivia_duel_answers
    set selected_option = p_selected_option, is_correct = v_is_correct, response_ms = v_ms, answered_at = now()
    where id = v_answer.id;

  -- +1 punto la primera vez que este usuario participa en este concurso
  select c.id into v_contest_id
    from public.trivia_contest_rounds r join public.trivia_contests c on c.id = r.contest_id
    where r.id = v_duel.round_id;

  insert into public.trivia_participation (contest_id, user_id) values (v_contest_id, auth.uid())
  on conflict do nothing;
  get diagnostics v_new_rows = row_count;
  if v_new_rows > 0 then
    update public.profiles set points = points + 1 where id = auth.uid();
  end if;

  return v_is_correct;
end;
$$;

-- 13) AUTOMATIZACIÓN: abre rondas, las cierra, resuelve desempates y
-- encadena la siguiente ronda sola, todo sin que Luis tenga que hacer nada.
-- Se engancha al mismo reloj de cada minuto que ya revisa subastas y rematazos.

-- Abre las rondas que ya llegaron a su hora programada: arma parejas al azar
-- y le da a cada pareja su propio set de 5 preguntas (nunca compartido).
create or replace function public._auto_open_trivia_rounds()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_round public.trivia_contest_rounds%rowtype;
  v_contest public.trivia_contests%rowtype;
  v_ids uuid[];
  v_n integer;
  v_i integer;
  v_duel_id uuid;
begin
  for v_round in
    select * from public.trivia_contest_rounds where status = 'scheduled' and scheduled_start <= now() for update skip locked
  loop
    select * into v_contest from public.trivia_contests where id = v_round.contest_id;

    if v_round.round_number = 1 then
      v_ids := array(select user_id from public.trivia_signups where contest_id = v_round.contest_id and status = 'inscrito' order by random());
    else
      v_ids := array(
        select d.winner_id from public.trivia_duels d
        join public.trivia_contest_rounds r on r.id = d.round_id
        where r.contest_id = v_round.contest_id and r.round_number = v_round.round_number - 1 and d.winner_id is not null
        order by random()
      );
    end if;

    v_n := coalesce(array_length(v_ids, 1), 0);

    if v_n < 1 then
      update public.trivia_contest_rounds set status = 'closed', closed_at = now(), window_closed = true where id = v_round.id;
      update public.trivia_contests set status = 'closed' where id = v_round.contest_id;
      continue;
    end if;

    if v_n = 1 then
      -- caso rarísimo (ej. todos los demás quedaron eliminados): campeón directo
      update public.trivia_contest_rounds set status = 'closed', closed_at = now(), window_closed = true where id = v_round.id;
      update public.trivia_contests set status = 'closed', winner_user_id = v_ids[1] where id = v_round.contest_id;
      update public.trivia_signups set status = 'ganador' where contest_id = v_round.contest_id and user_id = v_ids[1];
      update public.profiles set points = points + 30 where id = v_ids[1];
      continue;
    end if;

    v_i := 1;
    while v_i <= v_n loop
      if v_i = v_n then
        -- número impar de jugadores: el último de la lista mezclada pasa directo (bye)
        insert into public.trivia_duels (round_id, player1_id, player2_id, status, winner_id, is_bye)
        values (v_round.id, v_ids[v_i], null, 'closed', v_ids[v_i], true);
      else
        insert into public.trivia_duels (round_id, player1_id, player2_id, status)
        values (v_round.id, v_ids[v_i], v_ids[v_i + 1], 'pending')
        returning id into v_duel_id;

        insert into public.trivia_duel_questions (duel_id, question_id, slot)
        select v_duel_id, id, row_number() over ()
        from (
          select id from public.trivia_questions
          where status = 'approved' and (v_contest.category_id is null or category_id = v_contest.category_id)
          order by random()
          limit 5
        ) picked;
      end if;
      v_i := v_i + 2;
    end loop;

    update public.trivia_contest_rounds set status = 'open', opened_at = now() where id = v_round.id;
  end loop;
end;
$$;

-- Cuando el tiempo de una ronda ya se acabó: puntúa cada duelo. Si ambos no
-- respondieron nada, los dos quedan eliminados. Si hay empate total en
-- aciertos y tiempo, pasa el duelo a desempate en vez de cerrarlo.
create or replace function public._auto_close_trivia_rounds()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_round public.trivia_contest_rounds%rowtype;
  v_duel record;
  v_p1_correct integer; v_p2_correct integer;
  v_p1_time bigint; v_p2_time bigint;
  v_p1_answered integer; v_p2_answered integer;
  v_max_ms bigint;
begin
  for v_round in
    select * from public.trivia_contest_rounds
    where status = 'open' and not window_closed and now() >= opened_at + (window_minutes || ' minutes')::interval
    for update skip locked
  loop
    v_max_ms := v_round.per_question_seconds::bigint * 1000;

    for v_duel in
      select * from public.trivia_duels where round_id = v_round.id and status = 'pending' and is_bye = false for update skip locked
    loop
      select count(*) filter (where a.is_correct), count(*) filter (where a.selected_option is not null),
             coalesce(sum(a.response_ms) filter (where a.selected_option is not null), 0)
        into v_p1_correct, v_p1_answered, v_p1_time
        from public.trivia_duel_questions dq
        left join public.trivia_duel_answers a on a.duel_question_id = dq.id and a.user_id = v_duel.player1_id
        where dq.duel_id = v_duel.id and dq.slot between 1 and 5;

      select count(*) filter (where a.is_correct), count(*) filter (where a.selected_option is not null),
             coalesce(sum(a.response_ms) filter (where a.selected_option is not null), 0)
        into v_p2_correct, v_p2_answered, v_p2_time
        from public.trivia_duel_questions dq
        left join public.trivia_duel_answers a on a.duel_question_id = dq.id and a.user_id = v_duel.player2_id
        where dq.duel_id = v_duel.id and dq.slot between 1 and 5;

      -- las preguntas que no se respondieron cuentan como el tiempo máximo,
      -- para que "no jugar" nunca sea mejor estrategia que intentar
      v_p1_time := v_p1_time + (5 - v_p1_answered) * v_max_ms;
      v_p2_time := v_p2_time + (5 - v_p2_answered) * v_max_ms;

      if v_p1_answered = 0 and v_p2_answered = 0 then
        update public.trivia_duels
          set status = 'closed', winner_id = null, p1_correct_count = 0, p2_correct_count = 0, p1_total_ms = 0, p2_total_ms = 0
          where id = v_duel.id;
      elsif v_p1_correct = v_p2_correct and v_p1_time = v_p2_time then
        update public.trivia_duels
          set status = 'tiebreak', tiebreak_round = 1,
              tiebreak_deadline = now() + ((v_round.per_question_seconds + 5) || ' seconds')::interval,
              p1_correct_count = v_p1_correct, p2_correct_count = v_p2_correct, p1_total_ms = v_p1_time, p2_total_ms = v_p2_time
          where id = v_duel.id;

        insert into public.trivia_duel_questions (duel_id, question_id, slot)
        select v_duel.id, id, 6
        from public.trivia_questions
        where status = 'approved' and id not in (select question_id from public.trivia_duel_questions where duel_id = v_duel.id)
        order by random() limit 1;
      else
        update public.trivia_duels
          set status = 'closed',
              winner_id = case
                when v_p1_correct <> v_p2_correct then
                  case when v_p1_correct > v_p2_correct then v_duel.player1_id else v_duel.player2_id end
                else
                  case when v_p1_time < v_p2_time then v_duel.player1_id else v_duel.player2_id end
              end,
              p1_correct_count = v_p1_correct, p2_correct_count = v_p2_correct, p1_total_ms = v_p1_time, p2_total_ms = v_p2_time
          where id = v_duel.id;
      end if;
    end loop;

    update public.trivia_contest_rounds set window_closed = true where id = v_round.id;
  end loop;
end;
$$;

-- Resuelve los duelos en desempate cuyo mini-plazo ya venció: si alguien
-- acertó y el otro no (o acertó más rápido), gana. Si siguen empatados,
-- agrega otra pregunta de desempate más (hasta 5 veces), y si después de
-- esas 5 siguen empatados, elige un ganador al azar.
create or replace function public._auto_resolve_trivia_tiebreaks()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_duel record;
  v_slot integer;
  v_dq public.trivia_duel_questions%rowtype;
  v_p1 public.trivia_duel_answers%rowtype;
  v_p2 public.trivia_duel_answers%rowtype;
  v_winner uuid;
  v_seconds integer;
begin
  for v_duel in
    select * from public.trivia_duels where status = 'tiebreak' and tiebreak_deadline <= now() for update skip locked
  loop
    v_slot := 5 + v_duel.tiebreak_round;
    select * into v_dq from public.trivia_duel_questions where duel_id = v_duel.id and slot = v_slot;

    select * into v_p1 from public.trivia_duel_answers where duel_question_id = v_dq.id and user_id = v_duel.player1_id;
    select * into v_p2 from public.trivia_duel_answers where duel_question_id = v_dq.id and user_id = v_duel.player2_id;

    v_winner := null;
    if coalesce(v_p1.is_correct, false) and not coalesce(v_p2.is_correct, false) then
      v_winner := v_duel.player1_id;
    elsif coalesce(v_p2.is_correct, false) and not coalesce(v_p1.is_correct, false) then
      v_winner := v_duel.player2_id;
    elsif coalesce(v_p1.is_correct, false) and coalesce(v_p2.is_correct, false) then
      v_winner := case when coalesce(v_p1.response_ms, 999999) <= coalesce(v_p2.response_ms, 999999) then v_duel.player1_id else v_duel.player2_id end;
    end if;

    if v_winner is not null then
      update public.trivia_duels set status = 'closed', winner_id = v_winner where id = v_duel.id;
    elsif v_duel.tiebreak_round >= 5 then
      v_winner := case when random() < 0.5 then v_duel.player1_id else v_duel.player2_id end;
      update public.trivia_duels set status = 'closed', winner_id = v_winner where id = v_duel.id;
    else
      select per_question_seconds into v_seconds from public.trivia_contest_rounds where id = v_duel.round_id;

      update public.trivia_duels
        set tiebreak_round = tiebreak_round + 1,
            tiebreak_deadline = now() + ((v_seconds + 5) || ' seconds')::interval
        where id = v_duel.id;

      insert into public.trivia_duel_questions (duel_id, question_id, slot)
      select v_duel.id, id, v_slot + 1
      from public.trivia_questions
      where status = 'approved' and id not in (select question_id from public.trivia_duel_questions where duel_id = v_duel.id)
      order by random() limit 1;
    end if;
  end loop;
end;
$$;

-- Cuando TODOS los duelos de una ronda ya quedaron cerrados (incluidos los
-- que pasaron por desempate): cierra la ronda, marca eliminados, y si queda
-- más de un ganador programa la siguiente ronda sola (para "ahora + los
-- minutos que Luis definió"). Si solo queda un ganador, cierra el concurso
-- completo y le da sus 30 puntos.
create or replace function public._auto_finalize_trivia_rounds()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_round public.trivia_contest_rounds%rowtype;
  v_winners uuid[];
  v_participants uuid[];
  v_losers uuid[];
  v_n integer;
  v_name text;
begin
  for v_round in
    select r.* from public.trivia_contest_rounds r
    where r.status = 'open' and r.window_closed
      and not exists (select 1 from public.trivia_duels d where d.round_id = r.id and d.status <> 'closed')
    for update skip locked
  loop
    select array_agg(winner_id) into v_winners from public.trivia_duels where round_id = v_round.id and winner_id is not null;

    select (array_agg(player1_id) filter (where player1_id is not null)) || (array_agg(player2_id) filter (where player2_id is not null))
      into v_participants
      from public.trivia_duels where round_id = v_round.id;

    v_losers := array(select unnest(v_participants) except select unnest(coalesce(v_winners, array[]::uuid[])));
    if v_losers is not null and array_length(v_losers, 1) > 0 then
      update public.trivia_signups set status = 'eliminado' where contest_id = v_round.contest_id and user_id = any(v_losers);
    end if;

    v_n := coalesce(array_length(v_winners, 1), 0);

    if v_n = 0 then
      update public.trivia_contests set status = 'closed' where id = v_round.contest_id;
    elsif v_n = 1 then
      update public.trivia_contests set status = 'closed', winner_user_id = v_winners[1] where id = v_round.contest_id;
      update public.trivia_signups set status = 'ganador' where contest_id = v_round.contest_id and user_id = v_winners[1];
      update public.profiles set points = points + 30 where id = v_winners[1];
    else
      v_name := public._trivia_round_name(v_n);
      insert into public.trivia_contest_rounds
        (contest_id, round_number, round_name, scheduled_start, window_minutes, per_question_seconds, advance_delay_minutes, prize_description)
      values (
        v_round.contest_id, v_round.round_number + 1, v_name,
        now() + (v_round.advance_delay_minutes || ' minutes')::interval,
        v_round.window_minutes, v_round.per_question_seconds, v_round.advance_delay_minutes, v_round.prize_description
      );
    end if;

    update public.trivia_contest_rounds set status = 'closed', closed_at = now() where id = v_round.id;
  end loop;
end;
$$;

-- Punto de entrada único de todo el concurso
create or replace function public._auto_process_trivia()
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._auto_open_trivia_rounds();
  perform public._auto_close_trivia_rounds();
  perform public._auto_resolve_trivia_tiebreaks();
  perform public._auto_finalize_trivia_rounds();
end;
$$;

revoke all on function public._auto_open_trivia_rounds() from public, anon, authenticated;
revoke all on function public._auto_close_trivia_rounds() from public, anon, authenticated;
revoke all on function public._auto_resolve_trivia_tiebreaks() from public, anon, authenticated;
revoke all on function public._auto_finalize_trivia_rounds() from public, anon, authenticated;
revoke all on function public._auto_process_trivia() from public, anon, authenticated;

-- Se engancha al mismo reloj de cada minuto que ya revisa subastas y rematazos
create or replace function public._auto_process_auctions()
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._auto_close_expired_auctions();
  perform public._auto_finalize_confirming_auctions();
  perform public._auto_close_rematazos();
  perform public._auto_process_trivia();
end;
$$;

revoke all on function public._auto_process_auctions() from public, anon, authenticated;

-- 14) TIEMPO REAL: activa las tablas para que los cambios se transmitan en vivo
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trivia_contests'
  ) then
    alter publication supabase_realtime add table public.trivia_contests;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trivia_contest_rounds'
  ) then
    alter publication supabase_realtime add table public.trivia_contest_rounds;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trivia_duels'
  ) then
    alter publication supabase_realtime add table public.trivia_duels;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trivia_signups'
  ) then
    alter publication supabase_realtime add table public.trivia_signups;
  end if;
end $$;
