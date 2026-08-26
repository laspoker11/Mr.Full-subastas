-- Fase 2 de Rematazos: qué puede ver el cliente en su propio perfil
-- ("Mi panel MrFull" combinando subastas y rematazos).
-- Segura de correr aunque la vuelvas a correr después.

alter table public.site_settings
  add column if not exists perfil_show_subastas boolean not null default true,
  add column if not exists perfil_show_rematazos boolean not null default true,
  add column if not exists perfil_show_ranking boolean not null default true,
  add column if not exists perfil_show_historial boolean not null default false,
  add column if not exists perfil_show_direcciones boolean not null default false;

create or replace function public.update_profile_visibility(
  p_show_subastas boolean, p_show_rematazos boolean, p_show_ranking boolean,
  p_show_historial boolean, p_show_direcciones boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede cambiar esto'; end if;

  update public.site_settings
    set perfil_show_subastas = p_show_subastas, perfil_show_rematazos = p_show_rematazos,
        perfil_show_ranking = p_show_ranking, perfil_show_historial = p_show_historial,
        perfil_show_direcciones = p_show_direcciones, updated_at = now()
    where id = 1;
end;
$$;
