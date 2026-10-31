import { supabase } from '../config/supabase.js';

export const PLAN_COMMISSION_RATES = Object.freeze({
  starter: 3.5,
  pro: 2.5,
  scale: 1,
});

export const getCommissionRate = async (clienteId) => {
  if (!clienteId || clienteId === 'default') return 0;

  let { data, error } = await supabase
    .from('configuraciones_pago')
    .select('plan_tier, comision_porcentaje')
    .eq('cliente_id', clienteId)
    .maybeSingle();

  if (error) throw new Error(`No se pudo consultar el plan del comercio: ${error.message}`);

  if (!data) {
    const result = await supabase
      .from('configuraciones_pago')
      .select('plan_tier, comision_porcentaje')
      .eq('tienda_id', clienteId)
      .maybeSingle();

    if (result.error) throw new Error(`No se pudo consultar el plan de la tienda: ${result.error.message}`);
    data = result.data;
  }

  const planTier = data?.plan_tier || 'starter';
  if (planTier === 'custom') return 0;

  const rate = Object.prototype.hasOwnProperty.call(PLAN_COMMISSION_RATES, planTier)
    ? PLAN_COMMISSION_RATES[planTier]
    : Number(data?.comision_porcentaje);
  return Number.isFinite(rate) && rate >= 0 ? rate : PLAN_COMMISSION_RATES.starter;
};

export const calculateCommissionAmount = async (clienteId, monto) => {
  const rate = await getCommissionRate(clienteId);
  return Math.round((Number(monto) * rate / 100 + Number.EPSILON) * 100) / 100;
};
