import { Router } from 'express';
import { crearCobro } from '../controllers/paymentController.js';
import { recibirWebhookMP } from '../controllers/webhookController.js';
import { obtenerBilleteras, registrarPagoUSDT } from '../controllers/usdtController.js';
import { supabase } from '../config/supabase.js';
import multer from 'multer';
import { crearProducto, obtenerDescargaAprobada, obtenerProducto } from '../controllers/productController.js';

const router = Router();
const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (file.mimetype !== 'application/pdf') {
      return callback(new Error('Solo se permiten archivos PDF'));
    }
    return callback(null, true);
  },
});
const manejarCargaPdf = (req, res, next) => {
  uploadPdf.single('archivo')(req, res, (error) => {
    if (error) {
      const status = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: error.message });
    }
    return next();
  });
};

// Mercado Pago
router.post('/crear-cobro', crearCobro);
router.post('/webhooks/mercadopago', recibirWebhookMP);

// Ebooks
router.post('/productos/crear', manejarCargaPdf, crearProducto);
router.get('/productos/:id', obtenerProducto);
router.get('/productos/descarga/:paymentId', obtenerDescargaAprobada);

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