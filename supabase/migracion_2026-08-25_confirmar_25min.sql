-- Migración: sube el tiempo por defecto para confirmar un premio ganado,
-- de 15 a 25 minutos. Solo afecta subastas NUEVAS que se creen desde ahora
-- (no cambia el tiempo de subastas que ya estén "esperando confirmación").
-- Segura de correr aunque la vuelvas a correr después.

alter table public.auctions alter column confirm_window_min set default 25;
alter table public.auction_templates alter column confirm_window_min set default 25;
