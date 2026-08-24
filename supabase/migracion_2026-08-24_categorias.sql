-- Migración: reinstala completo el sistema de categorías (tabla, permisos
-- y funciones). Segura de correr aunque ya la hayas corrido antes o solo a
-- medias: todo usa "si no existe" / "reemplaza", no borra nada existente.

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
