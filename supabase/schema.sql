-- ============================================================
-- MrFull Subastas — Esquema de base de datos para Supabase
-- ============================================================
-- Cómo usar: entra a tu proyecto en supabase.com -> SQL Editor ->
-- pega TODO este archivo -> Run. Se ejecuta una sola vez.

-- 1) PERFILES (uno por usuario registrado) ---------------------
-- Nota de privacidad: el teléfono se guarda en una tabla aparte
-- (contact_info) para que NINGÚN usuario común pueda leer los
-- teléfonos de otros usuarios — solo el dueño del dato y los admins.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  is_admin boolean not null default false,
  points integer not null default 0,
  auctions_participated integer not null default 0,
  auctions_won integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "cualquiera autenticado puede ver perfiles basicos"
  on public.profiles for select
  using (auth.role() = 'authenticated');

create policy "el usuario puede actualizar su propio perfil"
  on public.profiles for update
  using (auth.uid() = id);

-- Teléfonos: tabla separada, solo visible para el dueño o un admin
create table public.contact_info (
  id uuid primary key references public.profiles(id) on delete cascade,
  phone text not null
);

alter table public.contact_info enable row level security;

create policy "el propio usuario o un admin puede ver el telefono"
  on public.contact_info for select
  using (
    auth.uid() = id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

create policy "el usuario puede actualizar su propio telefono"
  on public.contact_info for update
  using (auth.uid() = id);

-- Crea el perfil automáticamente cuando alguien se registra
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'Sin nombre'));

  insert into public.contact_info (id, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'phone', ''));

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2) SUBASTAS ----------------------------------------------------
create table public.auctions (
  id uuid primary key default gen_random_uuid(),
  display_id bigserial unique not null,
  title text not null,
  description text default '',
  image_url text default '',
  start_price integer not null check (start_price > 0),
  max_price integer check (max_price is null or max_price >= start_price),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  confirm_window_min integer not null default 25,
  status text not null default 'live' check (status in ('live','confirming','closed','void')),
  winner_user_id uuid references public.profiles(id),
  winner_bid_id uuid,
  confirm_deadline timestamptz,
  winner_confirmed boolean not null default false,
  confirm_attempt integer not null default 1,
  repeat_remaining integer not null default 0,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancel_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.auctions enable row level security;

create policy "cualquiera autenticado puede ver subastas"
  on public.auctions for select
  using (auth.role() = 'authenticated');

-- Nadie inserta/edita subastas directamente: todo pasa por funciones (más abajo)

-- 3) PUJAS ---------------------------------------------------------
create table public.bids (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  amount integer not null check (amount > 0),
  voided boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.bids enable row level security;

create policy "cualquiera autenticado puede ver pujas"
  on public.bids for select
  using (auth.role() = 'authenticated');

-- Las pujas también se insertan solo vía función place_bid (evita trampas)

-- índice para que el ranking de cada subasta cargue rápido con miles de pujas
create index bids_auction_amount_idx on public.bids (auction_id, amount desc, created_at asc);

-- 3c) PARTICIPACIÓN (una fila por usuario+subasta, para dar puntos una sola vez) --
create table public.auction_participation (
  auction_id uuid not null references public.auctions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (auction_id, user_id)
);

alter table public.auction_participation enable row level security;

create policy "cualquiera autenticado puede ver quien participo"
  on public.auction_participation for select
  using (auth.role() = 'authenticated');

-- 3b) PLANTILLAS (productos "estándar" que se reusan sin volver a escribirlos) ---
create table public.auction_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  image_url text default '',
  start_price integer not null check (start_price > 0),
  max_price integer check (max_price is null or max_price >= start_price),
  duration_min integer not null default 15,
  confirm_window_min integer not null default 25,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.auction_templates enable row level security;

create policy "solo admins ven las plantillas"
  on public.auction_templates for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- 3d) DISEÑO (una sola fila: tema activo, logo, imagen de portada) -----
create table public.site_settings (
  id integer primary key default 1,
  theme text not null default 'fuego' check (theme in ('fuego', 'neon', 'tropical')),
  logo_url text default '',
  cover_image_url text default '',
  updated_at timestamptz not null default now(),
  constraint site_settings_singleton check (id = 1)
);

insert into public.site_settings (id) values (1);

alter table public.site_settings enable row level security;

create policy "cualquiera puede ver el diseño (incluso sin sesión)"
  on public.site_settings for select
  using (true);

-- Actualizar el diseño (solo admins)
create function public.update_site_settings(p_theme text, p_logo_url text, p_cover_image_url text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede cambiar el diseño'; end if;
  if p_theme not in ('fuego', 'neon', 'tropical') then raise exception 'Tema inválido'; end if;

  update public.site_settings
    set theme = p_theme, logo_url = p_logo_url, cover_image_url = p_cover_image_url, updated_at = now()
    where id = 1;
end;
$$;

-- (insertar/borrar plantillas también pasa por funciones, más abajo)

-- 4) FUNCIONES SEGURAS (toda la lógica de negocio vive aquí) -------

-- Crear subasta (solo admins) — starts_at es opcional: si no se da, empieza ya mismo
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

-- Programar una subasta que se repite varias veces (ej: cada día a la misma hora)
create function public.schedule_recurring_auctions(
  p_title text, p_description text, p_image_url text,
  p_start_price integer, p_duration_min integer, p_confirm_window_min integer,
  p_first_start timestamptz, p_repeat_count integer, p_interval_hours numeric,
  p_max_price integer default null, p_category_id uuid default null
) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_id uuid;
  v_start timestamptz;
  i integer;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then
    raise exception 'Solo un administrador puede programar subastas';
  end if;
  if p_repeat_count < 1 or p_repeat_count > 100 then
    raise exception 'La cantidad de repeticiones debe estar entre 1 y 100';
  end if;
  if p_max_price is not null and p_max_price < p_start_price then
    raise exception 'El precio máximo no puede ser menor al precio inicial';
  end if;

  for i in 0..(p_repeat_count - 1) loop
    v_start := p_first_start + (i * p_interval_hours || ' hours')::interval;
    insert into public.auctions (title, description, image_url, start_price, max_price, starts_at, ends_at, confirm_window_min, created_by, category_id)
    values (p_title, p_description, p_image_url, p_start_price, p_max_price, v_start,
            v_start + (p_duration_min || ' minutes')::interval, p_confirm_window_min, auth.uid(), p_category_id)
    returning id into v_id;
    return next v_id;
  end loop;
  return;
end;
$$;

-- Guardar una plantilla reutilizable (solo admins)
create function public.save_template(
  p_title text, p_description text, p_image_url text,
  p_start_price integer, p_duration_min integer, p_confirm_window_min integer,
  p_max_price integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_id uuid;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede guardar plantillas'; end if;

  insert into public.auction_templates (title, description, image_url, start_price, max_price, duration_min, confirm_window_min, created_by)
  values (p_title, p_description, p_image_url, p_start_price, p_max_price, p_duration_min, p_confirm_window_min, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Borrar una plantilla (solo admins)
create function public.delete_template(p_template_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede borrar plantillas'; end if;
  delete from public.auction_templates where id = p_template_id;
end;
$$;

-- Calcula el salto mínimo entre pujas según el tamaño de la subasta
-- (debe coincidir exactamente con quickIncrements() en el frontend)
create function public.min_increment(p_start_price integer)
returns integer
language sql immutable as $$
  select case
    when p_start_price <= 10000 then 1000
    when p_start_price <= 25000 then 2000
    when p_start_price <= 50000 then 3000
    when p_start_price <= 100000 then 5000
    else 10000
  end;
$$;

-- Pujar (cualquier usuario autenticado, sobre sí mismo)
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

-- Anular puja sospechosa (solo admin)
create function public.void_bid(p_bid_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede anular pujas'; end if;
  update public.bids set voided = true where id = p_bid_id;
end;
$$;

-- Cerrar subasta y anunciar ganador (solo admin, cuando ya venció el tiempo)
-- Crea automáticamente la siguiente subasta de una cadena repetitiva,
-- si a la que se acaba de cerrar todavía le quedan repeticiones pendientes.
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

create function public.close_auction(p_auction_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_auction public.auctions%rowtype;
  v_top record;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede cerrar subastas'; end if;

  select * into v_auction from public.auctions where id = p_auction_id for update;
  if v_auction.status <> 'live' then raise exception 'La subasta no está en vivo'; end if;

  select id, user_id, amount into v_top from public.bids
    where auction_id = p_auction_id and voided = false
    order by amount desc, created_at asc limit 1;

  if v_top is null then
    update public.auctions set status = 'closed' where id = p_auction_id;
    perform public._maybe_chain_next(v_auction);
  else
    update public.auctions
      set status = 'confirming', winner_user_id = v_top.user_id, winner_bid_id = v_top.id,
          confirm_deadline = now() + (v_auction.confirm_window_min || ' minutes')::interval,
          winner_confirmed = false
      where id = p_auction_id;
  end if;
end;
$$;

-- El ganador confirma su cupo (solo el propio ganador)
create function public.confirm_win(p_auction_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_auction record;
begin
  select * into v_auction from public.auctions where id = p_auction_id for update;
  if v_auction.status <> 'confirming' or v_auction.winner_user_id <> auth.uid() then
    raise exception 'No eres el ganador de esta subasta o ya no está esperando confirmación';
  end if;
  update public.auctions set winner_confirmed = true where id = p_auction_id;
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

-- Pasar al siguiente postor si el ganador no confirmó a tiempo (solo admin).
-- Máximo se le da la oportunidad al 1er y al 2do postor: si el 2do tampoco
-- confirma, la subasta se cancela sola (no sigue bajando a un 3er postor).
create function public.pass_to_next(p_auction_id uuid)
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

-- Cancelar subasta completa (solo admin)
create function public.cancel_auction(p_auction_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean; v_status text;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede cancelar'; end if;

  select status into v_status from public.auctions where id = p_auction_id for update;
  if v_status is null then raise exception 'Subasta no encontrada'; end if;
  if v_status in ('closed', 'void') then raise exception 'Esta subasta ya está cerrada, no se puede cancelar'; end if;

  update public.auctions
    set status = 'void', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
    where id = p_auction_id;
end;
$$;

-- 5) TIEMPO REAL: activa las tablas para que los cambios se transmitan en vivo
alter publication supabase_realtime add table public.bids;
alter publication supabase_realtime add table public.auctions;
alter publication supabase_realtime add table public.site_settings;

-- 6) ALMACENAMIENTO: carpeta pública para el logo y la imagen de portada.
-- Cualquiera puede VER los archivos (por eso "public: true"), pero solo
-- un admin puede subir, reemplazar o borrar algo ahí.
insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do nothing;

drop policy if exists "cualquiera puede ver los assets del sitio" on storage.objects;
create policy "cualquiera puede ver los assets del sitio"
  on storage.objects for select
  using (bucket_id = 'site-assets');

drop policy if exists "solo admins pueden subir assets del sitio" on storage.objects;
create policy "solo admins pueden subir assets del sitio"
  on storage.objects for insert
  with check (bucket_id = 'site-assets' and exists (select 1 from public.profiles where id = auth.uid() and is_admin));

drop policy if exists "solo admins pueden actualizar assets del sitio" on storage.objects;
create policy "solo admins pueden actualizar assets del sitio"
  on storage.objects for update
  using (bucket_id = 'site-assets' and exists (select 1 from public.profiles where id = auth.uid() and is_admin));

drop policy if exists "solo admins pueden borrar assets del sitio" on storage.objects;
create policy "solo admins pueden borrar assets del sitio"
  on storage.objects for delete
  using (bucket_id = 'site-assets' and exists (select 1 from public.profiles where id = auth.uid() and is_admin));

-- ============================================================
-- 7) AUTOMATIZACIÓN TOTAL: revisa solo, cada minuto, si hay subastas
-- vencidas o confirmaciones vencidas, y las procesa sin que un
-- admin tenga que hacer nada. Así las cadenas de repetición
-- siguen andando toda la noche sin intervención manual.
-- ============================================================

-- Cierra las subastas cuyo tiempo ya se venció: si hubo pujas, pasa
-- a "esperando confirmación"; si no hubo ninguna, cierra y encadena.
create function public._auto_close_expired_auctions()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_auction public.auctions%rowtype;
  v_top record;
begin
  for v_auction in
    select * from public.auctions where status = 'live' and ends_at < now() for update skip locked
  loop
    select id, user_id, amount into v_top from public.bids
      where auction_id = v_auction.id and voided = false
      order by amount desc, created_at asc limit 1;

    if v_top is null then
      update public.auctions set status = 'closed' where id = v_auction.id;
      perform public._maybe_chain_next(v_auction);
    else
      update public.auctions
        set status = 'confirming', winner_user_id = v_top.user_id, winner_bid_id = v_top.id,
            confirm_deadline = now() + (v_auction.confirm_window_min || ' minutes')::interval,
            winner_confirmed = false
        where id = v_auction.id;
    end if;
  end loop;
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

-- Punto de entrada único que llama pg_cron cada minuto
create function public._auto_process_auctions()
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._auto_close_expired_auctions();
  perform public._auto_finalize_confirming_auctions();
end;
$$;

-- Nadie (ni admin ni cliente) puede llamar esto desde la app —
-- solo lo dispara el reloj interno de Supabase (pg_cron).
revoke all on function public._auto_close_expired_auctions() from public, anon, authenticated;
revoke all on function public._auto_finalize_confirming_auctions() from public, anon, authenticated;
revoke all on function public._auto_process_auctions() from public, anon, authenticated;

-- Programa el reloj: corre cada minuto, todo el día, todos los días
create extension if not exists pg_cron;
select cron.schedule('auto-process-auctions', '* * * * *', $$select public._auto_process_auctions()$$);

-- ============================================================
-- 8) REDENCIÓN DE PREMIOS: marca cuándo un ganador ya vino a
-- reclamar su premio en persona. Cualquier admin puede marcarla.
-- ============================================================

alter table public.auctions
  add column if not exists redeemed_at timestamptz,
  add column if not exists redeemed_by uuid references public.profiles(id);

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

-- ============================================================
-- 9) CATEGORÍAS: agrupar productos (ej: "Salchipapas", "Combos")
-- para que los clientes puedan filtrar la lista de subastas.
-- ============================================================

create table if not exists public.auction_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.auction_categories enable row level security;

drop policy if exists "cualquiera autenticado puede ver categorias" on public.auction_categories;
create policy "cualquiera autenticado puede ver categorias"
  on public.auction_categories for select
  using (auth.role() = 'authenticated');

-- Crear/borrar categorías solo pasa por estas funciones (más abajo)

alter table public.auctions
  add column if not exists category_id uuid references public.auction_categories(id);

-- Crea una categoría (solo admin). Si ya existe una con ese nombre
-- (sin importar mayúsculas/espacios), devuelve la existente en vez de fallar.
create or replace function public.create_category(p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_id uuid;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede crear categorías'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'El nombre de la categoría no puede estar vacío'; end if;

  select id into v_id from public.auction_categories where lower(name) = lower(trim(p_name));
  if v_id is not null then return v_id; end if;

  insert into public.auction_categories (name, created_by) values (trim(p_name), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Borra una categoría (solo admin). Las subastas que la tenían quedan sin
-- categoría (category_id vuelve null) gracias a la referencia de la columna.
create or replace function public.delete_category(p_category_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede borrar categorías'; end if;
  update public.auctions set category_id = null where category_id = p_category_id;
  delete from public.auction_categories where id = p_category_id;
end;
$$;

-- ============================================================
-- 10) COSTO DE ADMINISTRACIÓN: comisión (5%-10%, 8% por defecto) que se
-- suma a la puja ganadora. Es un solo número global editable por el admin;
-- cada subasta nueva "congela" el % activo al momento de crearse, así que
-- cambiar el número global no afecta subastas ya publicadas.
-- ============================================================

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

-- ============================================================
-- 11) REMATAZOS: ventas flash a precio fijo, con cupos y/o tiempo
-- limitado (lo que tú elijas al crear cada rematazo). Ver el detalle
-- completo de esta sección en supabase/migracion_2026-08-26_rematazos.sql
-- ============================================================

create table if not exists public.rematazo_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.rematazo_categories enable row level security;

drop policy if exists "cualquiera puede ver categorias de rematazos" on public.rematazo_categories;
create policy "cualquiera puede ver categorias de rematazos"
  on public.rematazo_categories for select
  using (true);

create table if not exists public.rematazos (
  id uuid primary key default gen_random_uuid(),
  display_id bigserial unique,
  category_id uuid references public.rematazo_categories(id),
  title text not null,
  description text default '',
  image_url text default '',
  price integer not null check (price > 0),
  old_price integer check (old_price is null or old_price >= price),
  entrega_modo text not null check (entrega_modo in ('mixto', 'domicilio', 'local')),
  limite_tipo text not null check (limite_tipo in ('tiempo', 'cantidad', 'ambos')),
  cupos_max integer check (cupos_max is null or cupos_max > 0),
  ends_at timestamptz,
  status text not null default 'activo' check (status in ('activo', 'cerrado', 'cancelado')),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancel_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.rematazos add column if not exists cupos_usados integer not null default 0;

alter table public.rematazos enable row level security;

drop policy if exists "cualquiera puede ver los rematazos" on public.rematazos;
create policy "cualquiera puede ver los rematazos"
  on public.rematazos for select
  using (true);

create table if not exists public.rematazo_signups (
  id uuid primary key default gen_random_uuid(),
  rematazo_id uuid not null references public.rematazos(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  entrega_via text not null check (entrega_via in ('domicilio', 'local')),
  direccion text default '',
  status text not null default 'inscrito' check (status in ('inscrito', 'confirmado', 'redimido', 'cancelado')),
  cancel_reason text,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (rematazo_id, user_id)
);

alter table public.rematazo_signups enable row level security;

drop policy if exists "el propio inscrito o un admin puede ver la inscripcion" on public.rematazo_signups;
create policy "el propio inscrito o un admin puede ver la inscripcion"
  on public.rematazo_signups for select
  using (
    auth.uid() = user_id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin)
  );

create or replace function public.create_rematazo_category(p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_id uuid;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede crear categorías'; end if;
  if p_name is null or trim(p_name) = '' then raise exception 'El nombre de la categoría no puede estar vacío'; end if;

  select id into v_id from public.rematazo_categories where lower(name) = lower(trim(p_name));
  if v_id is not null then return v_id; end if;

  begin
    insert into public.rematazo_categories (name, created_by) values (trim(p_name), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.rematazo_categories where lower(name) = lower(trim(p_name));
  end;
  return v_id;
end;
$$;

create or replace function public.create_rematazo(
  p_title text, p_price integer, p_entrega_modo text, p_limite_tipo text,
  p_description text default '', p_image_url text default '', p_category_id uuid default null,
  p_old_price integer default null, p_cupos_max integer default null, p_duracion_min integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_id uuid;
  v_ends_at timestamptz;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede publicar rematazos'; end if;
  if p_title is null or trim(p_title) = '' then raise exception 'Ponle un nombre al producto'; end if;
  if p_price is null or p_price <= 0 then raise exception 'El precio debe ser mayor a 0'; end if;
  if p_entrega_modo not in ('mixto', 'domicilio', 'local') then raise exception 'Modo de entrega inválido'; end if;
  if p_limite_tipo not in ('tiempo', 'cantidad', 'ambos') then raise exception 'Tipo de límite inválido'; end if;

  if p_limite_tipo in ('cantidad', 'ambos') and (p_cupos_max is null or p_cupos_max <= 0) then
    raise exception 'Debes indicar cuántos cupos tiene este rematazo';
  end if;
  if p_limite_tipo in ('tiempo', 'ambos') and (p_duracion_min is null or p_duracion_min <= 0) then
    raise exception 'Debes indicar la duración de este rematazo';
  end if;

  v_ends_at := case when p_limite_tipo in ('tiempo', 'ambos') then now() + (p_duracion_min || ' minutes')::interval else null end;

  insert into public.rematazos (title, description, image_url, category_id, price, old_price, entrega_modo, limite_tipo, cupos_max, ends_at, created_by)
  values (
    trim(p_title), coalesce(p_description, ''), coalesce(p_image_url, ''), p_category_id, p_price, p_old_price, p_entrega_modo, p_limite_tipo,
    case when p_limite_tipo in ('cantidad', 'ambos') then p_cupos_max else null end,
    v_ends_at, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.cancel_rematazo(p_rematazo_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean; v_status text;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede cancelar'; end if;

  select status into v_status from public.rematazos where id = p_rematazo_id for update;
  if v_status is null then raise exception 'Rematazo no encontrado'; end if;
  if v_status = 'cancelado' then raise exception 'Este rematazo ya está cancelado'; end if;

  update public.rematazos
    set status = 'cancelado', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
    where id = p_rematazo_id;
end;
$$;

create or replace function public.rematazo_signup(p_rematazo_id uuid, p_entrega_via text, p_direccion text default '')
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rematazo record;
  v_signup_id uuid;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para poder inscribirte'; end if;

  select * into v_rematazo from public.rematazos where id = p_rematazo_id for update;
  if v_rematazo is null then raise exception 'Rematazo no encontrado'; end if;
  if v_rematazo.status <> 'activo' then raise exception 'Este rematazo ya no está disponible'; end if;
  if v_rematazo.ends_at is not null and v_rematazo.ends_at < now() then
    raise exception 'El tiempo de este rematazo ya se acabó';
  end if;

  if p_entrega_via not in ('domicilio', 'local') then raise exception 'Elige domicilio o recoger en el local'; end if;
  if v_rematazo.entrega_modo <> 'mixto' and p_entrega_via <> v_rematazo.entrega_modo then
    raise exception 'Este rematazo solo se puede reclamar por %', v_rematazo.entrega_modo;
  end if;
  if p_entrega_via = 'domicilio' and (p_direccion is null or trim(p_direccion) = '') then
    raise exception 'Escribe tu dirección para el domicilio';
  end if;

  if v_rematazo.limite_tipo in ('cantidad', 'ambos') and v_rematazo.cupos_usados >= v_rematazo.cupos_max then
    raise exception 'Ya no hay cupos disponibles en este rematazo';
  end if;

  if exists (select 1 from public.rematazo_signups where rematazo_id = p_rematazo_id and user_id = auth.uid() and status = 'cancelado') then
    raise exception 'Ya no puedes inscribirte a este rematazo — tu cupo fue cancelado anteriormente.';
  end if;

  begin
    insert into public.rematazo_signups (rematazo_id, user_id, entrega_via, direccion)
    values (p_rematazo_id, auth.uid(), p_entrega_via, case when p_entrega_via = 'domicilio' then trim(p_direccion) else '' end)
    returning id into v_signup_id;
  exception when unique_violation then
    raise exception 'Ya estás inscrito en este rematazo';
  end;

  update public.rematazos set cupos_usados = cupos_usados + 1 where id = p_rematazo_id;

  if v_rematazo.limite_tipo in ('cantidad', 'ambos') and v_rematazo.cupos_usados + 1 >= v_rematazo.cupos_max then
    update public.rematazos set status = 'cerrado' where id = p_rematazo_id;
  end if;

  return v_signup_id;
end;
$$;

create or replace function public.confirm_rematazo_contact(p_signup_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_signup record;
begin
  select * into v_signup from public.rematazo_signups where id = p_signup_id for update;
  if v_signup is null or v_signup.user_id <> auth.uid() then
    raise exception 'Esta inscripción no te pertenece';
  end if;
  if v_signup.status = 'inscrito' then
    update public.rematazo_signups set status = 'confirmado' where id = p_signup_id;
  end if;
end;
$$;

create or replace function public.cancel_rematazo_signup(p_signup_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_signup record;
  v_rematazo record;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede hacer esto'; end if;

  select * into v_signup from public.rematazo_signups where id = p_signup_id for update;
  if v_signup is null then raise exception 'Inscripción no encontrada'; end if;
  if v_signup.status = 'redimido' then raise exception 'Este premio ya fue redimido, no se puede cancelar'; end if;
  if v_signup.status = 'cancelado' then raise exception 'Esta inscripción ya está cancelada'; end if;

  update public.rematazo_signups set status = 'cancelado', cancel_reason = p_reason where id = p_signup_id;

  select * into v_rematazo from public.rematazos where id = v_signup.rematazo_id for update;
  update public.rematazos set cupos_usados = greatest(cupos_usados - 1, 0) where id = v_rematazo.id;

  if v_rematazo.status = 'cerrado' and v_rematazo.limite_tipo in ('cantidad', 'ambos')
     and (v_rematazo.ends_at is null or v_rematazo.ends_at > now())
     and greatest(v_rematazo.cupos_usados - 1, 0) < v_rematazo.cupos_max then
    update public.rematazos set status = 'activo' where id = v_rematazo.id;
  end if;
end;
$$;

create or replace function public.mark_rematazo_redeemed(p_signup_id uuid, p_entrega_via text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_signup record;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede marcar como redimido'; end if;
  if p_entrega_via not in ('domicilio', 'local') then raise exception 'Debes indicar si fue domicilio o local'; end if;

  select * into v_signup from public.rematazo_signups where id = p_signup_id for update;
  if v_signup is null then raise exception 'Inscripción no encontrada'; end if;
  if v_signup.status <> 'confirmado' then
    raise exception 'Este inscrito debe confirmar por WhatsApp antes de poder redimir su rematazo';
  end if;

  update public.rematazo_signups
    set status = 'redimido', redeemed_at = now(), entrega_via = p_entrega_via
    where id = p_signup_id;

  update public.profiles set points = points + 5 where id = v_signup.user_id;
end;
$$;

create or replace function public._auto_close_rematazos()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.rematazos
    set status = 'cerrado'
    where status = 'activo' and limite_tipo in ('tiempo', 'ambos') and ends_at is not null and ends_at < now();
end;
$$;

revoke all on function public._auto_close_rematazos() from public, anon, authenticated;

create or replace function public._auto_process_auctions()
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._auto_close_expired_auctions();
  perform public._auto_finalize_confirming_auctions();
  perform public._auto_close_rematazos();
end;
$$;

revoke all on function public._auto_process_auctions() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rematazos'
  ) then
    alter publication supabase_realtime add table public.rematazos;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rematazo_signups'
  ) then
    alter publication supabase_realtime add table public.rematazo_signups;
  end if;
end $$;

-- Las fotos de rematazos usan el mismo bucket "site-assets" (carpeta
-- "rematazos/"), así que las políticas de Storage que ya existen alcanzan.

-- ============================================================
-- 12) PANEL DEL CLIENTE: qué puede ver cada cliente en su propio perfil
-- ("Mi panel MrFull", combinando subastas y rematazos).
-- ============================================================

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

-- ============================================================
-- 13) QUITAR DE LA VISTA PÚBLICA: el admin puede sacar subastas o
-- rematazos ya terminados de las páginas públicas, sin borrar nada
-- (siguen completos en el historial del panel Admin).
-- ============================================================

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

-- ============================================================
-- 14) PLANTILLAS DE REMATAZOS: productos que se guardan para reusar
-- después, igual que ya existe para subastas.
-- ============================================================

create table if not exists public.rematazo_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  image_url text default '',
  category_id uuid references public.rematazo_categories(id),
  price integer not null check (price > 0),
  old_price integer,
  entrega_modo text not null check (entrega_modo in ('mixto', 'domicilio', 'local')),
  limite_tipo text not null check (limite_tipo in ('tiempo', 'cantidad', 'ambos')),
  cupos_max integer,
  duracion_min integer,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.rematazo_templates enable row level security;

drop policy if exists "solo admins ven las plantillas de rematazos" on public.rematazo_templates;
create policy "solo admins ven las plantillas de rematazos"
  on public.rematazo_templates for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

create or replace function public.save_rematazo_template(
  p_title text, p_price integer, p_entrega_modo text, p_limite_tipo text,
  p_description text default '', p_image_url text default '', p_category_id uuid default null,
  p_old_price integer default null, p_cupos_max integer default null, p_duracion_min integer default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_id uuid;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede guardar plantillas'; end if;
  if p_title is null or trim(p_title) = '' then raise exception 'Ponle un nombre al producto'; end if;

  insert into public.rematazo_templates (title, description, image_url, category_id, price, old_price, entrega_modo, limite_tipo, cupos_max, duracion_min, created_by)
  values (trim(p_title), coalesce(p_description, ''), coalesce(p_image_url, ''), p_category_id, p_price, p_old_price, p_entrega_modo, p_limite_tipo, p_cupos_max, p_duracion_min, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_rematazo_template(p_template_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede borrar plantillas'; end if;
  delete from public.rematazo_templates where id = p_template_id;
end;
$$;

-- ============================================================
-- ÚLTIMO PASO (hazlo tú, manualmente, después de registrarte):
-- Ve a Table Editor -> profiles -> busca tu usuario -> pon
-- is_admin en TRUE. Así te conviertes en administrador.
-- ============================================================
