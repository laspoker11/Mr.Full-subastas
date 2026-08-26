-- Permite al admin "quitar de la vista pública" subastas y rematazos ya
-- terminados o cancelados. No se borra nada de la base de datos — sigue
-- apareciendo completo en el panel Admin (historial/cerrados/cancelados),
-- solo deja de mostrarse en las páginas públicas /  y /rematazos.
-- Segura de correr aunque la vuelvas a correr después.

alter table public.auctions add column if not exists hidden_public boolean not null default false;
alter table public.rematazos add column if not exists hidden_public boolean not null default false;

create or replace function public.hide_auction_public(p_auction_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean; v_status text;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede hacer esto'; end if;

  select status into v_status from public.auctions where id = p_auction_id;
  if v_status is null then raise exception 'Subasta no encontrada'; end if;
  if v_status not in ('closed', 'void') then
    raise exception 'Solo puedes quitar de la vista pública subastas que ya terminaron o fueron canceladas';
  end if;

  update public.auctions set hidden_public = true where id = p_auction_id;
end;
$$;

create or replace function public.hide_rematazo_public(p_rematazo_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean; v_status text;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede hacer esto'; end if;

  select status into v_status from public.rematazos where id = p_rematazo_id;
  if v_status is null then raise exception 'Rematazo no encontrado'; end if;
  if v_status not in ('cerrado', 'cancelado') then
    raise exception 'Solo puedes quitar de la vista pública rematazos que ya terminaron o fueron cancelados';
  end if;

  update public.rematazos set hidden_public = true where id = p_rematazo_id;
end;
$$;
