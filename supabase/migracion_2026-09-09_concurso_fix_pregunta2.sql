-- ============================================================
-- CONCURSO: arreglo al error "column reference duel_question_id is
-- ambiguous" al intentar ver la pregunta de un duelo. La causa: le
-- había puesto de nombre "duel_question_id" a uno de los valores que
-- devuelve get_my_duel_question(), y ese mismo nombre es también una
-- columna real de trivia_duel_answers — la base de datos no sabía a
-- cuál de los dos me refería. Se renombra a "dq_id" para que no
-- choque con nada. Segura de correr aunque la vuelvas a correr después.
-- ============================================================
drop function if exists public.get_my_duel_question(uuid, integer);

create function public.get_my_duel_question(p_duel_id uuid, p_slot integer)
returns table (
  dq_id uuid, question_text text, option_a text, option_b text, option_c text, option_d text,
  seconds_limit integer, deadline timestamptz
)
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

  select * into v_round from public.trivia_contest_rounds where id = v_duel.round_id;

  select * into v_dq from public.trivia_duel_questions where duel_id = p_duel_id and slot = p_slot;
  if v_dq is null then raise exception 'Esa pregunta todavía no está disponible'; end if;

  -- no dejar saltar preguntas, PERO si ya se le acabó el tiempo a la
  -- anterior (la haya respondido o no) sí puede pasar a esta
  if p_slot > 1 and p_slot <= 5 and not exists (
    select 1 from public.trivia_duel_answers a
    join public.trivia_duel_questions dqx on dqx.id = a.duel_question_id
    where dqx.duel_id = p_duel_id and dqx.slot = p_slot - 1 and a.user_id = auth.uid()
      and (a.selected_option is not null or now() > a.presented_at + (v_round.per_question_seconds || ' seconds')::interval)
  ) then
    raise exception 'Todavía te queda tiempo en la pregunta anterior';
  end if;

  insert into public.trivia_duel_answers (duel_id, duel_question_id, user_id, presented_at)
  values (p_duel_id, v_dq.id, auth.uid(), now())
  on conflict (duel_question_id, user_id) do nothing;

  return query
    select v_dq.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
           v_round.per_question_seconds,
           a.presented_at + (v_round.per_question_seconds || ' seconds')::interval
    from public.trivia_questions q
    join public.trivia_duel_answers a on a.duel_question_id = v_dq.id and a.user_id = auth.uid()
    where q.id = v_dq.question_id;
end;
$$;
