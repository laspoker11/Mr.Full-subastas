-- ============================================================
-- REMATAZOS: ventas flash a precio fijo, con cupos y/o tiempo
-- limitado (lo que tú elijas al crear cada rematazo).
-- Cómo usar: pega TODO este archivo en el SQL Editor de Supabase
-- y dale Run. Segura de correr aunque la vuelvas a correr después.
-- ============================================================

-- 1) CATEGORÍAS DE REMATAZOS (aparte de las categorías de subastas) ----
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

-- 2) REMATAZOS -----------------------------------------------------
create table if not exists public.rematazos (
  id uuid primary key default gen_random_uuid(),
  display_id bigserial unique,
  category_id uuid references public.rematazo_categories(id),
  title text not null,
  description text default '',
  image_url text default '',
  price integer not null check (price > 0),
  old_price integer check (old_price is null or old_price >= price),
  -- cómo se puede reclamar: solo domicilio, solo recoger en el local, o el cliente elige
  entrega_modo text not null check (entrega_modo in ('mixto', 'domicilio', 'local')),
  -- qué lo cierra: el tiempo, la cantidad de cupos, o lo que pase primero
  limite_tipo text not null check (limite_tipo in ('tiempo', 'cantidad', 'ambos')),
  cupos_max integer check (cupos_max is null or cupos_max > 0),   -- null cuando limite_tipo = 'tiempo'
  ends_at timestamptz,                                            -- null cuando limite_tipo = 'cantidad'
  status text not null default 'activo' check (status in ('activo', 'cerrado', 'cancelado')),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancel_reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- Contador público de inscritos activos (no cancelados). Vive aquí, y no en
-- una consulta a rematazo_signups, porque esa tabla solo la puede leer cada
-- quien su propia fila (o un admin) — así cualquiera puede ver "37/50" sin
-- exponer los datos de nadie más. Es "alter table" aparte (no una columna
-- más arriba) para que sea segura de agregar aunque la tabla ya exista.
alter table public.rematazos add column if not exists cupos_usados integer not null default 0;

alter table public.rematazos enable row level security;

drop policy if exists "cualquiera puede ver los rematazos" on public.rematazos;
create policy "cualquiera puede ver los rematazos"
  on public.rematazos for select
  using (true);

-- Nadie inserta/edita rematazos directamente: todo pasa por funciones (más abajo)

-- 3) INSCRIPCIONES ---------------------------------------------------
create table if not exists public.rematazo_signups (
  id uuid primary key default gen_random_uuid(),
  rematazo_id uuid not null references public.rematazos(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  entrega_via text not null check (entrega_via in ('domicilio', 'local')),
  direccion text default '',   -- obligatoria si entrega_via = 'domicilio' (se valida en la función)
  status text not null default 'inscrito' check (status in ('inscrito', 'confirmado', 'redimido', 'cancelado')),
  cancel_reason text,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  -- Un cupo por persona por rematazo, para siempre — si a alguien lo sacan
  -- (sin cobertura de domicilio, o porque el propio cliente pidió cancelar),
  -- esa decisión es definitiva PARA ESE REMATAZO. Sigue pudiendo inscribirse
  -- en cualquier otro rematazo sin problema.
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

-- 4) FUNCIONES SEGURAS -------------------------------------------------

-- Crear/reusar una categoría de rematazos (solo admin)
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

-- Crear un rematazo (solo admin)
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

-- Cancelar un rematazo completo (solo admin) — queda registrado con motivo, no se borra
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

-- Inscribirse a un rematazo (cualquier usuario autenticado, sobre sí mismo)
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
  -- Ojo: un "update" aquí antes del raise no serviría de nada — la excepción
  -- revierte toda la transacción, incluido ese update. El cierre real de un
  -- rematazo vencido lo hace _auto_close_rematazos() cada minuto.
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

  -- Si ya hubo un intento antes con este rematazo, el mensaje depende de por
  -- qué: si lo cancelaron (sin cobertura, o el cliente pidió salir), esa
  -- decisión es definitiva para este rematazo — no vuelve a intentar aquí,
  -- pero sí puede inscribirse en cualquier otro.
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

-- El propio inscrito confirma que va a escribir/escribió por WhatsApp
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

-- Sacar a alguien de un rematazo, ej. por falta de cobertura de domicilio
-- (solo admin). Nunca se borra: queda cancelado con motivo, y libera el cupo.
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

-- Marcar como entregado/redimido (solo admin) — exige que ya haya confirmado
-- por WhatsApp, y da 5 puntos al inscrito en ese momento (no antes).
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

-- 5) AUTOMATIZACIÓN: cierra solo los rematazos con tiempo vencido -------
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

-- Se engancha al mismo reloj de cada minuto que ya revisa las subastas
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

-- 6) TIEMPO REAL: activa las tablas para que los cambios se transmitan en vivo
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

-- Nota: las fotos de rematazos usan el mismo bucket "site-assets" que ya
-- existe (carpeta "rematazos/"), así que no hace falta crear otro bucket
-- ni otras políticas de Storage — las que ya están cubren cualquier carpeta.
