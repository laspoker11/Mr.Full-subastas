# Subastas MrFull — App real con cuentas de usuario y múltiples subastas en vivo

Esta app soporta miles de usuarios conectados en tiempo real, con registro por
correo/contraseña, varias subastas activas al mismo tiempo, y un panel de
administración separado para MrFull.

Ya fue probada de punta a punta (crear subasta, pujar, validaciones, cierre,
confirmación de ganador, seguridad de admin y privacidad de teléfonos) contra
una base de datos Postgres real antes de entregártela.

---

## Parte 1 — Crear el backend (Supabase) — 10 minutos

1. Ve a **[supabase.com](https://supabase.com)** → crea una cuenta gratis → **New Project**.
   - Elige una contraseña de base de datos (guárdala, no la necesitarás seguido).
   - Elige una región cercana (ej. São Paulo o la más cercana a Colombia).
2. Cuando el proyecto termine de crearse, ve a **SQL Editor** (menú izquierdo).
3. Abre el archivo `supabase/schema.sql` de esta carpeta, copia **todo** el contenido,
   pégalo en el SQL Editor y dale **Run**. Esto crea todas las tablas, seguridad y funciones.
4. Ve a **Project Settings → API**. Copia dos valores, los vas a necesitar en la Parte 2:
   - **Project URL** (algo como `https://xxxxx.supabase.co`)
   - **anon public key** (una clave larga)

### Convertirte en administrador
1. Regístrate normalmente en la app (una vez esté desplegada, Parte 2) con tu propio correo.
2. En Supabase, ve a **Table Editor → profiles**, busca tu fila (por tu nombre),
   y cambia la columna `is_admin` a `true`. Guarda.
3. Cierra sesión y vuelve a entrar en la app — ya verás el enlace "Panel Admin".

---

## Parte 2 — Publicar el sitio (Cloudflare Pages) — 10 minutos

1. Sube esta carpeta a un repositorio de GitHub (o pide ayuda si nunca lo has hecho).
2. Ve a **[pages.cloudflare.com](https://pages.cloudflare.com)** → crea una cuenta gratis
   → **Create a project** → **Connect to Git** → elige tu repositorio.
3. En la configuración de build:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. En **Environment variables**, agrega las dos que copiaste de Supabase:
   - `VITE_SUPABASE_URL` = tu Project URL
   - `VITE_SUPABASE_ANON_KEY` = tu anon public key
5. Dale **Save and Deploy**. En 1-2 minutos te da un link tipo `mrfull-subastas.pages.dev` — ya funciona.

---

## Parte 3 — Conectar tu dominio (mrfull.online) — 5 minutos + espera de DNS

1. En Cloudflare Pages, dentro de tu proyecto, ve a **Custom domains → Set up a custom domain**.
2. Escribe `mrfull.online` (y si quieres también `www.mrfull.online`).
3. Cloudflare te va a decir exactamente qué registro DNS agregar (normalmente un `CNAME`).
4. Entra a Hostinger → tu dominio → **DNS / Zona DNS** → agrega ese registro
   (y borra el que apunta actualmente a GoHighLevel, si sigue ahí).
5. Espera unos minutos a unas horas. Cuando propague, `mrfull.online` va a mostrar tu app directamente.

---

## Programar, repetir y usar plantillas de subastas

Ya no tienes que montar cada subasta manualmente cada vez. En el panel Admin:

- **Empezar ahora** vs. **Programar fecha/hora**: elige un radio button. Si programas,
  la subasta aparece para los clientes como "Próximamente" hasta que llegue esa hora exacta —
  ahí se activa sola, sin que tú tengas que hacer nada.
- **Repetir X veces**: si programaste una fecha/hora, puedes decir "repetir 7 veces cada
  24 horas" y se crean las 7 subastas de una sola vez, ya espaciadas correctamente.
  Útil para promociones diarias o semanales que se repiten igual.
- **Guardar como plantilla**: marca la casilla al crear una subasta y queda guardada.
  La próxima vez la eliges de la lista de "Plantillas guardadas" arriba del formulario
  y se rellenan todos los campos (nombre, precio, duración) automáticamente — solo
  ajustas la fecha si quieres.

Todo esto se genera de una sola vez al momento de programar (no depende de que un
servidor esté prendido 24/7 revisando el reloj) — es simplemente que cada subasta ya
tiene guardada su propia fecha de inicio, y la app la activa sola cuando llega esa hora.

---

## Cómo funciona por dentro (por si algo falla)

- **Autenticación:** maneja todo Supabase Auth (registro, login, sesión). No guardamos contraseñas nosotros.
- **Seguridad:** todas las acciones que modifican datos (pujar, crear subasta, cerrar,
  confirmar, anular pujas) pasan por funciones de base de datos (`supabase/schema.sql`)
  que verifican permisos del lado del servidor — nadie puede hacer trampa editando el
  código del navegador.
- **Tiempo real:** cuando alguien puja, todos los que están viendo esa subasta lo ven
  al instante (Supabase Realtime), sin recargar la página.
- **Privacidad:** los números de celular de los usuarios están en una tabla separada
  (`contact_info`) que solo el dueño del número o un administrador puede leer.
- **Escala:** el plan gratuito de Supabase soporta 200 conexiones en tiempo real
  simultáneas. Para tus 5.000 usuarios en vivo, sube a **Supabase Pro** ($25/mes +
  ~$10 por cada 1.000 conexiones extra) cuando el negocio lo justifique — no antes.
  No necesitas cambiar nada del código para eso, solo cambiar de plan en Supabase.

## Desarrollo local (opcional, si quieres probar cambios antes de publicarlos)

```bash
npm install
cp .env.example .env   # y pon ahí tu URL y anon key de Supabase
npm run dev
```
