-- Migración: al marcar una subasta como redimida, ahora hay que indicar si
-- fue por domicilio o recogida en el local. Segura de correr aunque ya la
-- hayas corrido antes.

-- Cómo se entregó el premio: a domicilio o recogido en el local
alter table public.auctions
  add column if not exists redeemed_via text check (redeemed_via in ('domicilio', 'local'));

create or replace function public.mark_redeemed(p_auction_id uuid, p_redeemed_via text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_auction record;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede marcar como redimida'; end if;
  if p_redeemed_via not in ('domicilio', 'local') then
    raise exception 'Debes indicar si fue domicilio o local';
  end if;

  select * into v_auction from public.auctions where id = p_auction_id for update;
  if v_auction is null then raise exception 'Subasta no encontrada'; end if;
  if v_auction.status <> 'closed' or v_auction.winner_user_id is null then
    raise exception 'Esta subasta no tiene un ganador cerrado para redimir';
  end if;
  if v_auction.redeemed_at is not null then
    raise exception 'Esta subasta ya fue marcada como redimida';
  end if;

  update public.auctions set redeemed_at = now(), redeemed_by = auth.uid(), redeemed_via = p_redeemed_via where id = p_auction_id;

  -- Los 30 puntos por ganar se dan hasta que el premio se redime de verdad,
  -- no en el momento de ganar la subasta.
  update public.profiles set points = points + 30 where id = v_auction.winner_user_id;
end;
$$;
