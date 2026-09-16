-- ============================================================
-- CONCURSO: deja que el admin quite un concurso de prueba (o
-- cualquier otro) de la vista pública, igual que ya se puede hacer
-- con subastas y rematazos. El concurso sigue existiendo (no se
-- borra nada), solo deja de aparecer en /concurso para los clientes.
-- Segura de correr aunque la vuelvas a correr después.
-- ============================================================
alter table public.trivia_contests add column if not exists hidden_public boolean not null default false;

create or replace function public.hide_trivia_contest_public(p_contest_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede hacer esto'; end if;

  if not exists (select 1 from public.trivia_contests where id = p_contest_id) then
    raise exception 'Concurso no encontrado';
  end if;

  update public.trivia_contests set hidden_public = true where id = p_contest_id;
end;
$$;
