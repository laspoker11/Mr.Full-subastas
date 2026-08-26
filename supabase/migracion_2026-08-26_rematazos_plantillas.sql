-- Plantillas de rematazos (productos que se guardan para reusar después,
-- igual que ya existe para subastas). La galería de fotos no necesita SQL
-- nuevo: usa el mismo bucket "site-assets" y las mismas políticas de
-- siempre, solo lee la carpeta "rematazos/" en vez de "auctions/".
-- Segura de correr aunque la vuelvas a correr después.

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
