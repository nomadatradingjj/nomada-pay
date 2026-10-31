create table if not exists public.configuraciones_pago (
  cliente_id text primary key,
  wallet_trc20 text not null default '',
  wallet_bep20 text not null default '',
  qr_trc20_url text not null default '',
  qr_bep20_url text not null default '',
  cotizacion_usd_ars numeric(14, 4) not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.configuraciones_pago enable row level security;

alter table public.productos
  add column if not exists tipo text not null default 'ebook',
  add column if not exists link_entrega text not null default '',
  add column if not exists activo boolean not null default true;

alter table public.transacciones
  add column if not exists cliente_id text not null default 'default',
  add column if not exists producto_id text,
  add column if not exists comprobante_path text;

create index if not exists productos_tienda_activos_idx
  on public.productos (tienda_id, activo);

create index if not exists transacciones_cliente_created_idx
  on public.transacciones (cliente_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprobantes-pagos',
  'comprobantes-pagos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'qr-pasarela',
  'qr-pasarela',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
