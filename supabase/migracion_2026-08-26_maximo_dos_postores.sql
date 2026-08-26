-- Migración: cuando el ganador de una subasta no confirma su cupo a tiempo,
-- el sistema le da la oportunidad al SIGUIENTE postor. Antes esto podía seguir
-- bajando indefinidamente (3ro, 4to, 5to...) hasta que alguien confirmara.
-- Ahora: máximo se le da la oportunidad al 1er y al 2do postor. Si el 2do
-- tampoco confirma a tiempo, la subasta se CANCELA sola (queda como "void",
-- igual que cuando un admin cancela con motivo).
-- Segura de correr aunque la vuelvas a correr después.

alter table public.auctions add column if not exists confirm_attempt integer not null default 1;

-- Pasar al siguiente postor si el ganador no confirmó a tiempo (solo admin).
-- Máximo se le da la oportunidad al 1er y al 2do postor: si el 2do tampoco
-- confirma, la subasta se cancela sola (no sigue bajando a un 3er postor).
create or replace function public.pass_to_next(p_auction_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_auction public.auctions%rowtype;
  v_next record;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede hacer esto'; end if;

  select * into v_auction from public.auctions where id = p_auction_id for update;
  if v_auction.status <> 'confirming' then raise exception 'La subasta no está esperando confirmación'; end if;

  update public.bids set voided = true where id = v_auction.winner_bid_id;

  if v_auction.confirm_attempt >= 2 then
    update public.auctions
      set status = 'void', winner_user_id = null, winner_bid_id = null,
          cancelled_at = now(), cancelled_by = auth.uid(),
          cancel_reason = 'Ni el primer ni el segundo postor confirmaron a tiempo'
      where id = p_auction_id;
    return;
  end if;

  select id, user_id, amount into v_next from public.bids
    where auction_id = p_auction_id and voided = false
    order by amount desc, created_at asc limit 1;

  if v_next is null then
    update public.auctions set status = 'closed', winner_user_id = null, winner_bid_id = null where id = p_auction_id;
    perform public._maybe_chain_next(v_auction);
  else
    update public.auctions
      set winner_user_id = v_next.user_id, winner_bid_id = v_next.id,
          confirm_deadline = now() + (v_auction.confirm_window_min || ' minutes')::interval,
          winner_confirmed = false, confirm_attempt = v_auction.confirm_attempt + 1
      where id = p_auction_id;
  end if;
end;
$$;

-- Resuelve las subastas cuyo tiempo de confirmación ya venció:
-- si el ganador SÍ confirmó a tiempo, archiva (encadena; los 30 puntos se dan
-- al redimir, no aquí); si NO confirmó, pasa al siguiente postor (o cierra y
-- encadena si no queda nadie). Solo se le da la oportunidad al 1er y al 2do
-- postor: si el 2do tampoco confirma, la subasta se cancela sola en vez de
-- seguir bajando a un 3er postor.
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

      if v_auction.confirm_attempt >= 2 then
        update public.auctions
          set status = 'void', winner_user_id = null, winner_bid_id = null,
              cancelled_at = now(),
              cancel_reason = 'Ni el primer ni el segundo postor confirmaron a tiempo'
          where id = v_auction.id;
      else
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
                winner_confirmed = false, confirm_attempt = v_auction.confirm_attempt + 1
            where id = v_auction.id;
        end if;
      end if;
    end if;
  end loop;
end;
$$;
