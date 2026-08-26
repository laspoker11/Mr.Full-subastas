-- Correcciones encontradas en revisión de código:
-- 1) rematazo_signup ya no intenta cerrar el rematazo justo antes de
--    cancelar la transacción (ese "update" nunca se guardaba de todas
--    formas — el cierre real por tiempo lo hace el reloj automático cada
--    minuto), y ahora da un mensaje claro cuando alguien que fue SACADO de
--    un rematazo intenta volver a inscribirse a ESE MISMO rematazo (queda
--    bloqueado solo ahí, sigue pudiendo inscribirse en cualquier otro).
-- 2) cancel_rematazo_signup: el chequeo para reabrir cupos usa el mismo
--    "no bajar de 0" que el número que de verdad se guarda.
-- 3) create_rematazo_category ya no truena si dos admins crean la misma
--    categoría al mismo instante.
-- Segura de correr aunque la vuelvas a correr después.

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
