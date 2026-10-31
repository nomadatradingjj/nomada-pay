alter table public.configuraciones_pago
  add column if not exists plan_tier text not null default 'starter',
  add column if not exists comision_porcentaje numeric(5, 2) not null default 3.5;

update public.configuraciones_pago
set comision_porcentaje = case plan_tier
  when 'starter' then 3.5
  when 'pro' then 2.5
  when 'scale' then 1
  when 'custom' then 0
  else 3.5
end;

alter table public.transacciones
  add column if not exists comision_monto numeric(14, 2) not null default 0;

update public.transacciones
set comision_monto = comision
where comision_monto = 0
  and coalesce(comision, 0) <> 0;

notify pgrst, 'reload schema';
