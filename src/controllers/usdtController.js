import { randomUUID } from 'node:crypto';
import { supabase } from '../config/supabase.js';

const PAYMENT_PROOF_BUCKET = 'comprobantes-pagos';

export const obtenerBilleteras = async (req, res) => {
  try {
    const clienteId = req.query.cliente_id || 'default';
    let { data, error } = await supabase
      .from('configuraciones_pago')
      .select('wallet_trc20, wallet_bep20, qr_trc20_url, qr_bep20_url, cotizacion_usd_ars')
      .eq('cliente_id', clienteId)
      .maybeSingle();

    if (error) {
      console.error('Error al consultar billeteras de pago:', error.message);
      return res.status(500).json({ error: 'No se pudieron consultar las billeteras' });
    }

    if (!data && clienteId !== 'default') {
      const resultadoDefault = await supabase
        .from('configuraciones_pago')
        .select('wallet_trc20, wallet_bep20, qr_trc20_url, qr_bep20_url, cotizacion_usd_ars')
        .eq('cliente_id', 'default')
        .maybeSingle();

      if (resultadoDefault.error) {
        console.error('Error al consultar billeteras por defecto:', resultadoDefault.error.message);
        return res.status(500).json({ error: 'No se pudieron consultar las billeteras por defecto' });
      }
      data = resultadoDefault.data;
    }

    return res.json({
      status: 'success',
      wallets: {
        trc20: data?.wallet_trc20 || process.env.USDT_TRC20_WALLET || '',
        bep20: data?.wallet_bep20 || process.env.USDT_BEP20_WALLET || '',
      },
      qr: {
        trc20: data?.qr_trc20_url || '',
        bep20: data?.qr_bep20_url || '',
      },
      cotizacion_usd_ars: data?.cotizacion_usd_ars || null,
    });
  } catch (error) {
    console.error('Error interno al consultar billeteras de pago:', error);
    return res.status(500).json({ error: 'Error interno al consultar las billeteras' });
  }
};

export const registrarPagoUSDT = async (req, res) => {
  let comprobantePath;
  try {
    const { producto_id: productoId, red, txid } = req.body;
    let { titulo, precio } = req.body;
    let clienteId = 'default';

    if (!red || !['trc20', 'bep20'].includes(String(red).toLowerCase()) || !txid || typeof txid !== 'string') {
      return res.status(400).json({ error: 'Faltan campos válidos: red o txid' });
    }

    if (productoId) {
      const { data: producto, error: productoError } = await supabase
        .from('productos')
        .select('titulo, precio_usd, tienda_id')
        .eq('id', productoId)
        .eq('activo', true)
        .single();

      if (productoError || !producto) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      titulo = producto.titulo;
      precio = producto.precio_usd;
      clienteId = producto.tienda_id || 'default';
    }

    if (productoId && !req.file) {
      return res.status(400).json({ error: 'Adjunta el comprobante de pago para registrar esta compra' });
    }

    const monto = Number(precio);
    if (typeof titulo !== 'string' || !titulo.trim() || !Number.isFinite(monto) || monto <= 0) {
      return res.status(400).json({ error: 'Se requieren título y precio válido para registrar el pago' });
    }

    if (req.file) {
      const extensiones = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'application/pdf': 'pdf',
      };
      const extension = extensiones[req.file.mimetype];
      if (!extension) {
        return res.status(400).json({ error: 'El comprobante debe ser una imagen o PDF' });
      }
      comprobantePath = `${clienteId}/${randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from(PAYMENT_PROOF_BUCKET)
        .upload(comprobantePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });

      if (uploadError) {
        console.error('Error al guardar el comprobante:', uploadError.message);
        return res.status(502).json({ error: 'No se pudo guardar el comprobante' });
      }
    }

    const customPreferenceId = `USDT-${String(red).toUpperCase()}-${Date.now()}`;

    const { data, error } = await supabase
      .from('transacciones')
      .insert([
        {
          preference_id: customPreferenceId,
          payment_id: txid,
          cliente_id: clienteId,
          producto_id: productoId || null,
          titulo: `${titulo.trim()} (${String(red).toUpperCase()})`,
          monto,
          comision: 0,
          estado: 'pending',
          pasarela: 'binance',
          comprobante_path: comprobantePath || null,
        }
      ])
      .select();

    if (error) {
      console.error('⚠️ Error al registrar pago USDT en Supabase:', error.message);
      if (comprobantePath) {
        const { error: cleanupError } = await supabase.storage.from(PAYMENT_PROOF_BUCKET).remove([comprobantePath]);
        if (cleanupError) console.error('No se pudo eliminar el comprobante tras fallar el registro:', cleanupError.message);
      }
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
    if (comprobantePath) {
      const { error: cleanupError } = await supabase.storage.from(PAYMENT_PROOF_BUCKET).remove([comprobantePath]);
      if (cleanupError) {
        console.error('No se pudo eliminar el comprobante tras fallar el registro:', cleanupError.message);
      }
    }
    return res.status(500).json({ error: 'Error interno al procesar el reporte de pago' });
  }
};