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
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  confirm_window_min integer not null default 15,
  status text not null default 'live' check (status in ('live','confirming','closed','void')),
  winner_user_id uuid references public.profiles(id),
  winner_bid_id uuid,
  confirm_deadline timestamptz,
  winner_confirmed boolean not null default false,
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

-- 3b) PLANTILLAS (productos "estándar" que se reusan sin volver a escribirlos) ---
create table public.auction_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  image_url text default '',
  start_price integer not null check (start_price > 0),
  duration_min integer not null default 15,
  confirm_window_min integer not null default 15,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.auction_templates enable row level security;

create policy "solo admins ven las plantillas"
  on public.auction_templates for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));

-- (insertar/borrar plantillas también pasa por funciones, más abajo)

-- 4) FUNCIONES SEGURAS (toda la lógica de negocio vive aquí) -------

-- Crear subasta (solo admins) — starts_at es opcional: si no se da, empieza ya mismo
create function public.create_auction(
  p_title text, p_description text, p_image_url text,
  p_start_price integer, p_duration_min integer, p_confirm_window_min integer,
  p_starts_at timestamptz default now()
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_id uuid;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then
    raise exception 'Solo un administrador puede publicar subastas';
  end if;

  insert into public.auctions (title, description, image_url, start_price, starts_at, ends_at, confirm_window_min, created_by)
  values (p_title, p_description, p_image_url, p_start_price, p_starts_at,
          p_starts_at + (p_duration_min || ' minutes')::interval, p_confirm_window_min, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Programar una subasta que se repite varias veces (ej: cada día a la misma hora)
create function public.schedule_recurring_auctions(
  p_title text, p_description text, p_image_url text,
  p_start_price integer, p_duration_min integer, p_confirm_window_min integer,
  p_first_start timestamptz, p_repeat_count integer, p_interval_hours numeric
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

  for i in 0..(p_repeat_count - 1) loop
    v_start := p_first_start + (i * p_interval_hours || ' hours')::interval;
    insert into public.auctions (title, description, image_url, start_price, starts_at, ends_at, confirm_window_min, created_by)
    values (p_title, p_description, p_image_url, p_start_price, v_start,
            v_start + (p_duration_min || ' minutes')::interval, p_confirm_window_min, auth.uid())
    returning id into v_id;
    return next v_id;
  end loop;
  return;
end;
$$;

-- Guardar una plantilla reutilizable (solo admins)
create function public.save_template(
  p_title text, p_description text, p_image_url text,
  p_start_price integer, p_duration_min integer, p_confirm_window_min integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_id uuid;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede guardar plantillas'; end if;

  insert into public.auction_templates (title, description, image_url, start_price, duration_min, confirm_window_min, created_by)
  values (p_title, p_description, p_image_url, p_start_price, p_duration_min, p_confirm_window_min, auth.uid())
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
create function public.place_bid(p_auction_id uuid, p_amount integer)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_auction record;
  v_top_amount integer;
  v_min integer;
  v_bid_id uuid;
begin
  select * into v_auction from public.auctions where id = p_auction_id for update;
  if v_auction is null then raise exception 'Subasta no encontrada'; end if;
  if v_auction.starts_at > now() then
    raise exception 'Esta subasta todavía no ha comenzado';
  end if;
  if v_auction.status <> 'live' or v_auction.ends_at < now() then
    raise exception 'Esta subasta ya cerró';
  end if;

  select max(amount) into v_top_amount from public.bids
    where auction_id = p_auction_id and voided = false;

  v_min := coalesce(v_top_amount + public.min_increment(v_auction.start_price), v_auction.start_price);
  if p_amount < v_min then
    raise exception 'La puja debe ser de al menos %', v_min;
  end if;

  insert into public.bids (auction_id, user_id, amount)
  values (p_auction_id, auth.uid(), p_amount)
  returning id into v_bid_id;

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
create function public.close_auction(p_auction_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_auction record;
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

-- Admin archiva la subasta ya confirmada
create function public.archive_auction(p_auction_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede archivar'; end if;
  update public.auctions set status = 'closed' where id = p_auction_id;
end;
$$;

-- Pasar al siguiente postor si el ganador no confirmó a tiempo (solo admin)
create function public.pass_to_next(p_auction_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean;
  v_auction record;
  v_next record;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede hacer esto'; end if;

  select * into v_auction from public.auctions where id = p_auction_id for update;
  if v_auction.status <> 'confirming' then raise exception 'La subasta no está esperando confirmación'; end if;

  update public.bids set voided = true where id = v_auction.winner_bid_id;

  select id, user_id, amount into v_next from public.bids
    where auction_id = p_auction_id and voided = false
    order by amount desc, created_at asc limit 1;

  if v_next is null then
    update public.auctions set status = 'closed', winner_user_id = null, winner_bid_id = null where id = p_auction_id;
  else
    update public.auctions
      set winner_user_id = v_next.user_id, winner_bid_id = v_next.id,
          confirm_deadline = now() + (v_auction.confirm_window_min || ' minutes')::interval,
          winner_confirmed = false
      where id = p_auction_id;
  end if;
end;
$$;

-- Cancelar subasta completa (solo admin)
create function public.cancel_auction(p_auction_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_is_admin boolean;
begin
  select is_admin into v_is_admin from public.profiles where id = auth.uid();
  if not coalesce(v_is_admin, false) then raise exception 'Solo un administrador puede cancelar'; end if;
  update public.auctions set status = 'void' where id = p_auction_id;
end;
$$;

-- 5) TIEMPO REAL: activa las tablas para que los cambios se transmitan en vivo
alter publication supabase_realtime add table public.bids;
alter publication supabase_realtime add table public.auctions;

-- ============================================================
-- ÚLTIMO PASO (hazlo tú, manualmente, después de registrarte):
-- Ve a Table Editor -> profiles -> busca tu usuario -> pon
-- is_admin en TRUE. Así te conviertes en administrador.
-- ============================================================
