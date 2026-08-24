-- Migración: máximo 3 premios ganados sin redimir, y los 30 puntos por
-- ganar se dan hasta que se redime el premio (no al momento de ganar).
-- Seguro de correr en el SQL Editor de Supabase: solo reemplaza estas
-- 4 funciones, no toca tablas ni datos existentes.

create or replace function public.place_bid(p_auction_id uuid, p_amount integer)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_auction record;
  v_top_amount integer;
  v_min integer;
  v_bid_id uuid;
  v_new_participant integer;
  v_unredeemed_wins integer;
begin
  select * into v_auction from public.auctions where id = p_auction_id for update;
  if v_auction is null then raise exception 'Subasta no encontrada'; end if;
  if v_auction.starts_at > now() then
    raise exception 'Esta subasta todavía no ha comenzado';
  end if;
  if v_auction.status <> 'live' or v_auction.ends_at < now() then
    raise exception 'Esta subasta ya cerró';
  end if;

  -- Si ya tiene 3 premios ganados sin redimir, no puede pujar en nada más
  -- hasta que redima al menos uno.
  select count(*) into v_unredeemed_wins from public.auctions
    where winner_user_id = auth.uid() and status = 'closed' and redeemed_at is null;
  if v_unredeemed_wins >= 3 then
    raise exception 'Tienes % premios ganados sin redimir. Debes redimir al menos uno antes de volver a pujar.', v_unredeemed_wins;
  end if;

  select max(amount) into v_top_amount from public.bids
    where auction_id = p_auction_id and voided = false;

  v_min := coalesce(v_top_amount + public.min_increment(v_auction.start_price), v_auction.start_price);
  if p_amount < v_min then
    raise exception 'La puja debe ser de al menos %', v_min;
  end if;
  if v_auction.max_price is not null and p_amount > v_auction.max_price then
    raise exception 'La puja no puede superar el máximo permitido de %', v_auction.max_price;
  end if;

  insert into public.bids (auction_id, user_id, amount)
  values (p_auction_id, auth.uid(), p_amount)
  returning id into v_bid_id;

  -- Da 2 puntos SOLO la primera vez que este usuario puja en esta subasta
  insert into public.auction_participation (auction_id, user_id)
  values (p_auction_id, auth.uid())
  on conflict do nothing;
  get diagnostics v_new_participant = row_count;
  if v_new_participant > 0 then
    update public.profiles
      set points = points + 2, auctions_participated = auctions_participated + 1
      where id = auth.uid();
  end if;

  return v_bid_id;
end;
$$;

-- Admin archiva la subasta ya confirmada (los 30 puntos se dan al redimir,
-- no aquí) y encadena la siguiente subasta si quedan repeticiones programadas.
create or replace function public.archive_auction(p_auction_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_auction public.auctions%rowtype;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede archivar'; end if;

  select * into v_auction from public.auctions where id = p_auction_id for update;
  if v_auction.status = 'closed' then return; end if;

  if v_auction.winner_user_id is not null then
    update public.profiles
      set auctions_won = auctions_won + 1
      where id = v_auction.winner_user_id;
  end if;

  update public.auctions set status = 'closed' where id = p_auction_id;
  perform public._maybe_chain_next(v_auction);
end;
$$;

-- Resuelve las subastas cuyo tiempo de confirmación ya venció:
-- si el ganador SÍ confirmó a tiempo, archiva (encadena; los 30 puntos se dan
-- al redimir, no aquí); si NO confirmó, pasa al siguiente postor (o cierra y
-- encadena si no queda nadie).
create or replace function public._auto_finalize_confirming_auctions()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_auction public.auctions%rowtype;
  v_next record;
begin
  for v_auction in
    select * from public.auctions where status = 'confirming' and confirm_deadline < now() for update skip locked
  loop
    if v_auction.winner_confirmed then
      if v_auction.winner_user_id is not null then
        update public.profiles
          set auctions_won = auctions_won + 1
          where id = v_auction.winner_user_id;
      end if;
      update public.auctions set status = 'closed' where id = v_auction.id;
      perform public._maybe_chain_next(v_auction);
    else
      update public.bids set voided = true where id = v_auction.winner_bid_id;
      select id, user_id, amount into v_next from public.bids
        where auction_id = v_auction.id and voided = false
        order by amount desc, created_at asc limit 1;
      if v_next is null then
        update public.auctions set status = 'closed', winner_user_id = null, winner_bid_id = null where id = v_auction.id;
        perform public._maybe_chain_next(v_auction);
      else
        update public.auctions
          set winner_user_id = v_next.user_id, winner_bid_id = v_next.id,
              confirm_deadline = now() + (v_auction.confirm_window_min || ' minutes')::interval,
              winner_confirmed = false
          where id = v_auction.id;
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.mark_redeemed(p_auction_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_auction record;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede marcar como redimida'; end if;

  select * into v_auction from public.auctions where id = p_auction_id for update;
  if v_auction is null then raise exception 'Subasta no encontrada'; end if;
  if v_auction.status <> 'closed' or v_auction.winner_user_id is null then
    raise exception 'Esta subasta no tiene un ganador cerrado para redimir';
  end if;
  if v_auction.redeemed_at is not null then
    raise exception 'Esta subasta ya fue marcada como redimida';
  end if;

  update public.auctions set redeemed_at = now(), redeemed_by = auth.uid() where id = p_auction_id;

  -- Los 30 puntos por ganar se dan hasta que el premio se redime de verdad,
  -- no en el momento de ganar la subasta.
  update public.profiles set points = points + 30 where id = v_auction.winner_user_id;
end;
$$;
