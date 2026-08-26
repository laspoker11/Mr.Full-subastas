# Subastas MrFull

## Contexto del negocio

MrFull vende salchipapas y comida callejera en Barranquilla, Colombia. Hace subastas en vivo por Facebook: publica un producto, los clientes pujan, gana la puja más alta. Los ganadores coordinan su visita agrupados de 5 en 5 (vía Calendly).

## Stack técnico

- **Frontend**: React + Vite, alojado en Cloudflare Pages (mr-full-subastas.pages.dev, y pronto también subastas.mrfull.online).
- **Backend**: Supabase (Postgres + Auth + Realtime + Storage).
- **Repositorio**: GitHub, `laspoker11/Mr.Full-subastas`, rama `main`.
- El SQL vive en `supabase/schema.sql` — **cualquier cambio a la base de datos debe reflejarse ahí Y correrse manualmente en el SQL Editor de Supabase** (no hay migraciones automáticas).

## Funciones ya construidas

- Cuentas de usuario (registro/login/recuperar contraseña) con Supabase Auth.
- Varias subastas en vivo al mismo tiempo, con pujas rápidas (+incrementos) o manuales.
- Precio máximo opcional por subasta.
- Plantillas de productos reutilizables.
- Programar subastas a futuro, y repetición automática (la siguiente se crea sola al cerrar la anterior, encadenada).
- Automatización total con pg_cron: cada minuto revisa subastas vencidas y confirmaciones vencidas, sin intervención manual.
- Sistema de puntos: +2 por participar en una subasta, +30 al redimir un premio ganado (no al momento de ganar). Máximo 3 premios ganados sin redimir por persona; si llega a ese límite no puede pujar en más subastas hasta redimir al menos uno. Página `/ranking` pública con tabla de posiciones y ganadores del día.
- Panel Admin (`/admin`) con 8 pestañas: Subastas, Por redimir, ⚡ Rematazos, 📋 Inscritos (rematazos), 📊 Ventas rematazos, Reporte, Usuarios, Diseño.
- Panel de Diseño: 3 temas visuales (Fuego Callejero, Noche Neón, Tropical Fresco) que cambian colores en vivo, más subida de logo e imagen de portada a Supabase Storage, más los interruptores de "qué puede ver el cliente en su perfil".
- Botón de WhatsApp flotante permanente + mensaje automático al ganar una subasta, al número 3005276415.
- Cancelar una subasta activa pide motivo, y queda registrado (no desaparece sin dejar rastro).
- Costo de administración: comisión de 5%-10% (8% por defecto, ajustable en Panel Admin → Diseño) que se suma a la puja ganadora. Cada subasta "congela" el % vigente al crearse, así que cambiar el número global no afecta subastas ya publicadas.
- **Rematazos** (`/rematazos`): ventas flash a precio fijo, con cupos y/o tiempo limitado (a elegir por rematazo). Requiere cuenta para inscribirse. Admin puede crear varios en lote, organizados por categoría, con foto, modo de entrega (mixto/domicilio/local) y tipo de límite (tiempo/cantidad/ambos). Inscripción → confirmación por WhatsApp → redención (+5 puntos, solo si ya confirmó). Sacar a alguien del cupo pide motivo y queda registrado, sin bloquearlo de volver a inscribirse. "Mi Perfil" combina subastas y rematazos en un panel único; el admin controla qué secciones ve cada cliente. Pensado para vivir en `rematazos.mrfull.online` (mismo proyecto de Cloudflare Pages, detecta el dominio para mostrar esta sección).
- Al redimir un premio, el admin elige si fue por domicilio o recogido en el local (se guarda por subasta).
- Reporte financiero con filtro por rango de fechas (hoy / 7 días / mes / rango personalizado) y detalle agrupado por día o por mes.

## Cómo trabajar con el usuario dueño de este proyecto

- **No es programador.** Explicar en español, sin tecnicismos, qué se va a hacer antes de hacerlo.
- **Probar siempre los cambios** (build sin errores, y si se toca SQL, verificar la sintaxis) antes de dar algo por terminado.
- Al terminar un cambio, decir **exactamente qué probar** en la app real para confirmar que funcionó.
- Si el cambio necesita algo en Supabase (SQL) además del código, **decirlo aparte y claro**, porque eso lo tiene que correr él manualmente en el SQL Editor de Supabase.
