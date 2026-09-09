-- ============================================================
-- CONCURSO: arreglo — trivia_questions no tenía NINGUNA política de
-- lectura, ni siquiera para el admin, así que el panel "Preguntas
-- pendientes por revisar" siempre salía vacío aunque la importación
-- sí funcionara. Le agrega permiso de lectura SOLO a administradores
-- (los usuarios normales siguen sin poder verla nunca, para que nadie
-- se entere de la respuesta correcta por fuera de un duelo). Segura
-- de correr aunque la vuelvas a correr después.
-- ============================================================
drop policy if exists "solo los administradores pueden ver el banco de preguntas" on public.trivia_questions;
create policy "solo los administradores pueden ver el banco de preguntas"
  on public.trivia_questions for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin));
