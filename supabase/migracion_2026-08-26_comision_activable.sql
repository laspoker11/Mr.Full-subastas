-- Agrega un interruptor para activar/desactivar el costo de administración
-- por completo (mientras esté apagado, las subastas nuevas no cobran nada
-- de comisión — el % que dejes guardado queda listo para cuando lo actives).
-- De paso, vuelve a crear update_commission_percent (por si en tu base no
-- había quedado creada — el error "could not find the function ... in the
-- schema cache" pasa quaso eso).
-- Segura de correr aunque la vuelvas a correr después.

alter table public.site_settings add column if not exists commission_enabled boolean not null default true;

create or replace function public.update_commission_percent(p_percent numeric, p_enabled boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede cambiar la comisión'; end if;
  if p_percent < 5 or p_percent > 10 then
    raise exception 'La comisión debe estar entre 5%% y 10%%';
  end if;
  update public.site_settings set commission_percent = p_percent, commission_enabled = p_enabled, updated_at = now() where id = 1;
end;
$$;

-- Al crear una subasta, congela 0% si el cobro está apagado (en vez del %
-- configurado) — así una subasta creada mientras está apagado nunca cobra,
-- aunque después vuelvas a activarlo.
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

  select case when commission_enabled then commission_percent else 0 end into v_commission
    from public.site_settings where id = 1;

  insert into public.auctions (title, description, image_url, start_price, max_price, starts_at, ends_at, confirm_window_min, created_by, repeat_remaining, category_id, commission_percent)
  values (p_title, p_description, p_image_url, p_start_price, p_max_price, p_starts_at,
          p_starts_at + (p_duration_min || ' minutes')::interval, p_confirm_window_min, auth.uid(), coalesce(p_repeat_remaining, 0), p_category_id, coalesce(v_commission, 0))
  returning id into v_id;

  return v_id;
end;
$$;

-- Lo mismo para cuando una subasta encadenada se crea sola al cerrar la anterior.
create or replace function public._maybe_chain_next(v_auction public.auctions)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_duration interval;
  v_commission numeric;
begin
  if coalesce(v_auction.repeat_remaining, 0) > 0 then
    v_duration := v_auction.ends_at - v_auction.starts_at;
    select case when commission_enabled then commission_percent else 0 end into v_commission
      from public.site_settings where id = 1;
    insert into public.auctions (title, description, image_url, start_price, max_price, starts_at, ends_at, confirm_window_min, created_by, repeat_remaining, category_id, commission_percent)
    values (v_auction.title, v_auction.description, v_auction.image_url, v_auction.start_price, v_auction.max_price,
            now(), now() + v_duration, v_auction.confirm_window_min, v_auction.created_by, v_auction.repeat_remaining - 1, v_auction.category_id, coalesce(v_commission, 0));
  end if;
end;
$$;
