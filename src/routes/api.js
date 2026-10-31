import { Router } from 'express';
import { crearCobro } from '../controllers/paymentController.js';
import { recibirWebhookMP } from '../controllers/webhookController.js';
import { obtenerBilleteras, registrarPagoUSDT } from '../controllers/usdtController.js';
import multer from 'multer';
import {
  cambiarEstadoTransaccion,
  crearProducto,
  getConfiguracion,
  listarProductos,
  listarTransacciones,
  obtenerDescargaAprobada,
  obtenerProducto,
  subirQrPago,
  updateConfiguracion,
} from '../controllers/productController.js';
import { getSupabasePublicConfig, iniciarSesionDashboard } from '../controllers/dashboardAuthController.js';
import { requireDashboardAuth, validarAlcanceCliente } from '../middleware/requireDashboardAuth.js';

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
const uploadComprobante = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const tiposPermitidos = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!tiposPermitidos.includes(file.mimetype)) {
      return callback(new Error('El comprobante debe ser una imagen JPG, PNG, WebP o un PDF'));
    }
    return callback(null, true);
  },
});
const manejarCargaComprobante = (req, res, next) => {
  uploadComprobante.single('comprobante')(req, res, (error) => {
    if (error) {
      const status = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: error.message });
    }
    return next();
  });
};
const uploadQr = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const tiposPermitidos = ['image/jpeg', 'image/png', 'image/webp'];
    if (!tiposPermitidos.includes(file.mimetype)) {
      return callback(new Error('El QR debe ser una imagen JPG, PNG o WebP'));
    }
    return callback(null, true);
  },
});
const manejarCargaQr = (req, res, next) => {
  uploadQr.single('qr')(req, res, (error) => {
    if (error) {
      const status = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: error.message });
    }
    return next();
  });
};

// Dashboard authentication and tenant-scoped management
router.get('/dashboard/public-config', getSupabasePublicConfig);
router.post('/dashboard/login', iniciarSesionDashboard);
router.get('/config/:clienteId?', requireDashboardAuth, validarAlcanceCliente, getConfiguracion);
router.put('/config/:clienteId?', requireDashboardAuth, validarAlcanceCliente, updateConfiguracion);
router.put('/config/:clienteId/qr/:red', requireDashboardAuth, validarAlcanceCliente, manejarCargaQr, subirQrPago);
router.get('/productos/:clienteId?', requireDashboardAuth, validarAlcanceCliente, listarProductos);
router.post('/productos', requireDashboardAuth, validarAlcanceCliente, manejarCargaPdf, crearProducto);
router.get('/transacciones/:clienteId?', requireDashboardAuth, validarAlcanceCliente, listarTransacciones);
router.patch('/transacciones/:id/estado', requireDashboardAuth, cambiarEstadoTransaccion);
router.get('/historial-transacciones', requireDashboardAuth, listarTransacciones);
router.post('/cambiar-estado-transaccion', requireDashboardAuth, cambiarEstadoTransaccion);

// Mercado Pago
router.post('/crear-cobro', crearCobro);
router.post('/webhooks/mercadopago', recibirWebhookMP);

// Ebooks
router.get('/productos/descarga/:paymentId', obtenerDescargaAprobada);
router.get('/producto/:id', obtenerProducto);
router.post('/productos/crear', requireDashboardAuth, validarAlcanceCliente, manejarCargaPdf, crearProducto);

// USDT Multired
router.get('/usdt-wallets', obtenerBilleteras);
router.post('/registrar-pago-usdt', manejarCargaComprobante, registrarPagoUSDT);

export default router;