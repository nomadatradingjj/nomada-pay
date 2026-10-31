alter table public.configuraciones_pago
  add column if not exists tienda_id text;

update public.configuraciones_pago
set tienda_id = cliente_id
where tienda_id is null;

create index if not exists configuraciones_pago_tienda_id_idx
  on public.configuraciones_pago (tienda_id);

notify pgrst, 'reload schema';
