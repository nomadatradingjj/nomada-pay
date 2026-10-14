import { Router } from 'express';
import { crearCobro } from '../controllers/paymentController.js';
import { recibirWebhookMP } from '../controllers/webhookController.js';
import { obtenerBilleteras, registrarPagoUSDT } from '../controllers/usdtController.js';
import { supabase } from '../config/supabase.js';

const router = Router();

// Mercado Pago
router.post('/crear-cobro', crearCobro);
router.post('/webhooks/mercadopago', recibirWebhookMP);

// USDT Multired
router.get('/usdt-wallets', obtenerBilleteras);
router.post('/registrar-pago-usdt', registrarPagoUSDT);

// Dashboard B2B - Historial de Transacciones
router.get('/historial-transacciones', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transacciones')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Error al consultar Supabase' });
  }
});

// Cambiar estado de transacción (Aprobar / Rechazar)
router.post('/cambiar-estado-transaccion', async (req, res) => {
  try {
    const { id, estado } = req.body;

    if (!id || !estado) {
      return res.status(400).json({ error: 'Faltan parámetros: id y estado' });
    }

    const { data, error } = await supabase
      .from('transacciones')
      .update({ estado: estado })
      .eq('id', id)
      .select();

    if (error) {
      console.error('⚠️ Error al actualizar estado en Supabase:', error.message);
      return res.status(500).json({ error: error.message });
    }

    console.log(`✅ Transacción ${id} actualizada a: ${estado}`);
    return res.json({ status: 'success', data: data[0] });
  } catch (err) {
    console.error('Error interno al cambiar estado:', err);
    return res.status(500).json({ error: 'Error interno al actualizar la transacción' });
  }
});

export default router;