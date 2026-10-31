create or replace view public.productos_digitales
with (security_invoker = true)
as
select *
from public.productos;

grant select, insert, update, delete on public.productos_digitales to service_role;

notify pgrst, 'reload schema';
