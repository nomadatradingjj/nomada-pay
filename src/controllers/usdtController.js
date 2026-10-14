import { supabase } from '../config/supabase.js';

// Endpoint para obtener las direcciones públicas
export const obtenerBilleteras = (req, res) => {
  return res.json({
    status: 'success',
    wallets: {
      trc20: process.env.USDT_TRC20_WALLET || 'Dirección TRC20 no configurada',
      bep20: process.env.USDT_BEP20_WALLET || 'Dirección BEP20 no configurada'
    }
  });
};

// Endpoint para registrar el pago reportado por el cliente
export const registrarPagoUSDT = async (req, res) => {
  try {
    const { titulo, precio, red, txid } = req.body;

    if (!titulo || !precio || !red || !txid) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: titulo, precio, red o txid' });
    }

    const customPreferenceId = `USDT-${red.toUpperCase()}-${Date.now()}`;

    const { data, error } = await supabase
      .from('transacciones')
      .insert([
        {
          preference_id: customPreferenceId,
          payment_id: txid,
          titulo: `${titulo} (${red.toUpperCase()})`,
          monto: Number(precio),
          comision: 0,
          estado: 'pending',
          pasarela: 'binance'
        }
      ])
      .select();

    if (error) {
      console.error('⚠️ Error al registrar pago USDT en Supabase:', error.message);
      return res.status(500).json({ error: 'Error al registrar en la base de datos' });
    }

    console.log('✅ Pago USDT Multired registrado en Supabase:', data[0].id);

    return res.json({
      status: 'success',
      id: data[0].id,
      mensaje: 'Pago registrado correctamente para verificación'
    });

  } catch (error) {
    console.error('Error interno en registrarPagoUSDT:', error);
    return res.status(500).json({ error: 'Error interno al procesar el reporte de pago' });
  }
};