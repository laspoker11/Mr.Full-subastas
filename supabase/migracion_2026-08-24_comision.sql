-- Migración: costo de administración (comisión de 5%-10%, 8% por defecto)
-- que se suma a la puja ganadora. Segura de correr aunque la vuelvas a
-- correr después: no borra nada, solo agrega columnas/funciones si faltan.

alter table public.site_settings
  add column if not exists commission_percent numeric not null default 8
    check (commission_percent >= 5 and commission_percent <= 10);

alter table public.auctions
  add column if not exists commission_percent numeric not null default 8
    check (commission_percent >= 0);

-- Cambiar el % global de comisión (solo admin)
create or replace function public.update_commission_percent(p_percent numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede cambiar la comisión'; end if;
  if p_percent < 5 or p_percent > 10 then
    raise exception 'La comisión debe estar entre 5%% y 10%%';
  end if;
  update public.site_settings set commission_percent = p_percent, updated_at = now() where id = 1;
end;
$$;

-- Crear subasta (solo admins) — ahora guarda el % de comisión vigente
create or replace function public.create_auction(
  p_title text, p_description text, p_image_url text,
  p_start_price integer, p_duration_min integer, p_confirm_window_min integer,
  p_starts_at timestamptz default now(), p_max_price integer default null,
  p_repeat_remaining integer default 0, p_category_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_id uuid;
  v_commission numeric;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then
    raise exception 'Solo un administrador puede publicar subastas';
  end if;
  if p_max_price is not null and p_max_price < p_start_price then
    raise exception 'El precio máximo no puede ser menor al precio inicial';
  end if;

  select commission_percent into v_commission from public.site_settings where id = 1;

  insert into public.auctions (title, description, image_url, start_price, max_price, starts_at, ends_at, confirm_window_min, created_by, repeat_remaining, category_id, commission_percent)
  values (p_title, p_description, p_image_url, p_start_price, p_max_price, p_starts_at,
          p_starts_at + (p_duration_min || ' minutes')::interval, p_confirm_window_min, auth.uid(), coalesce(p_repeat_remaining, 0), p_category_id, coalesce(v_commission, 8))
  returning id into v_id;

  return v_id;
end;
$$;

-- Encadena la siguiente subasta de una repetición — ahora toma el % de
-- comisión vigente en ese momento (no copia el de la subasta anterior).
create or replace function public._maybe_chain_next(v_auction public.auctions)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_duration interval;
  v_commission numeric;
begin
  if coalesce(v_auction.repeat_remaining, 0) > 0 then
    v_duration := v_auction.ends_at - v_auction.starts_at;
    select commission_percent into v_commission from public.site_settings where id = 1;
    insert into public.auctions (title, description, image_url, start_price, max_price, starts_at, ends_at, confirm_window_min, created_by, repeat_remaining, category_id, commission_percent)
    values (v_auction.title, v_auction.description, v_auction.image_url, v_auction.start_price, v_auction.max_price,
            now(), now() + v_duration, v_auction.confirm_window_min, v_auction.created_by, v_auction.repeat_remaining - 1, v_auction.category_id, coalesce(v_commission, 8));
  end if;
end;
$$;
