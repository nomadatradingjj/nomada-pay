import { randomUUID } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import { Payment } from 'mercadopago';
import { mpClient } from '../config/mp.js';

const PRODUCT_BUCKET = 'ebooks-privados';
const SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;
const PAYMENT_PROOF_BUCKET = 'comprobantes-pagos';
const PAYMENT_PROOF_URL_TTL_SECONDS = 10 * 60;

const esUrlWebValida = (valor) => {
  if (typeof valor !== 'string' || !valor.trim()) return false;
  try {
    const url = new URL(valor);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

export const getConfiguracion = async (req, res) => {
  try {
    const idCliente = req.user?.cliente_id || req.user?.tienda_id || 'default';
    let { data, error } = await supabase
      .from('configuraciones_pago')
      .select('cliente_id, tienda_id, wallet_trc20, wallet_bep20, qr_trc20_url, qr_bep20_url, cotizacion_usd_ars')
      .eq('cliente_id', idCliente)
      .maybeSingle();

    if (error) {
      console.error('Error al consultar la configuración de pago:', error.message);
      return res.status(400).json({ error: error.message });
    }

    if (!data && idCliente !== 'default') {
      const resultadoTienda = await supabase
        .from('configuraciones_pago')
        .select('cliente_id, tienda_id, wallet_trc20, wallet_bep20, qr_trc20_url, qr_bep20_url, cotizacion_usd_ars')
        .eq('tienda_id', idCliente)
        .maybeSingle();

      if (resultadoTienda.error) {
        console.error('Error al consultar la configuración por tienda:', resultadoTienda.error.message);
        return res.status(400).json({ error: resultadoTienda.error.message });
      }
      data = resultadoTienda.data;
    }

    if (!data) {
      return res.status(200).json({
        cliente_id: idCliente,
        wallet_trc20: process.env.USDT_TRC20_WALLET || '',
        wallet_bep20: process.env.USDT_BEP20_WALLET || '',
        qr_trc20_url: '',
        qr_bep20_url: '',
        cotizacion_usd_ars: 1620,
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Error interno al consultar la configuración de pago:', error);
    return res.status(500).json({ error: 'Error interno al consultar la configuración de pago' });
  }
};

export const updateConfiguracion = async (req, res) => {
  const idCliente = req.user?.cliente_id || req.user?.tienda_id || 'default';
  const body = req.body || {};
  const camposConfiguracion = {
    wallet_trc20: body.wallet_trc20,
    wallet_bep20: body.wallet_bep20,
    qr_trc20_url: body.qr_trc20_url,
    qr_bep20_url: body.qr_bep20_url,
    cotizacion_usd_ars: body.cotizacion_usd_ars,
  };
  const camposTexto = ['wallet_trc20', 'wallet_bep20', 'qr_trc20_url', 'qr_bep20_url'];

  for (const campo of camposTexto) {
    if (camposConfiguracion[campo] === undefined) {
      camposConfiguracion[campo] = '';
      continue;
    }
    if (typeof camposConfiguracion[campo] !== 'string' || camposConfiguracion[campo].length > 2048) {
      return res.status(400).json({ error: `El campo ${campo} debe ser texto de hasta 2048 caracteres` });
    }
    if (campo.startsWith('qr_') && camposConfiguracion[campo].trim() && !esUrlWebValida(camposConfiguracion[campo])) {
      return res.status(400).json({ error: `El campo ${campo} debe ser una URL HTTP o HTTPS válida` });
    }
    camposConfiguracion[campo] = camposConfiguracion[campo].trim();
  }

  const cotizacion = Number(camposConfiguracion.cotizacion_usd_ars);
  if (!Number.isFinite(cotizacion) || cotizacion <= 0) {
    return res.status(400).json({ error: 'La cotización USD/ARS debe ser un número mayor a cero' });
  }
  camposConfiguracion.cotizacion_usd_ars = cotizacion;

  try {
    const { data, error } = await supabase
      .from('configuraciones_pago')
      .upsert({
        cliente_id: idCliente,
        tienda_id: idCliente,
        ...camposConfiguracion,
      }, { onConflict: 'cliente_id' })
      .select();

    if (error) {
      console.error('Error upsert config:', error);
      return res.status(400).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Error interno al actualizar la configuración de pago:', error);
    return res.status(500).json({ error: 'Error interno al actualizar la configuración de pago' });
  }
};

export const subirQrPago = async (req, res) => {
  const { red } = req.params;
  const extensiones = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const archivo = req.file;

  if (!['trc20', 'bep20'].includes(red) || !archivo || !extensiones[archivo.mimetype]) {
    return res.status(400).json({ error: 'Selecciona un QR válido para la red TRC20 o BEP20' });
  }

  const idCliente = req.user?.cliente_id || req.user?.tienda_id || 'default';
  const qrPath = `${idCliente}/${red}.${extensiones[archivo.mimetype]}`;
  try {
    const { error: uploadError } = await supabase.storage
      .from('qr-pasarela')
      .upload(qrPath, archivo.buffer, {
        contentType: archivo.mimetype,
        upsert: true,
      });

    if (uploadError) {
      console.error('Error al subir el QR de pago:', uploadError.message);
      return res.status(502).json({ error: 'No se pudo guardar el QR' });
    }

    const { data: publicUrl } = supabase.storage.from('qr-pasarela').getPublicUrl(qrPath);
    const campoUrl = `qr_${red}_url`;
    const { data, error } = await supabase
      .from('configuraciones_pago')
      .upsert({
        cliente_id: idCliente,
        tienda_id: idCliente,
        [campoUrl]: publicUrl.publicUrl,
      }, { onConflict: 'cliente_id' })
      .select('cliente_id, wallet_trc20, wallet_bep20, qr_trc20_url, qr_bep20_url, cotizacion_usd_ars')
      .single();

    if (error) {
      console.error('Error al registrar la URL del QR:', error.message);
      return res.status(500).json({ error: 'El archivo se guardó, pero no se pudo actualizar su configuración' });
    }

    return res.json({ configuracion: data, qr_url: publicUrl.publicUrl });
  } catch (error) {
    console.error('Error interno al subir el QR de pago:', error);
    return res.status(500).json({ error: 'Error interno al guardar el QR' });
  }
};

export const listarProductos = async (req, res) => {
  try {
    const idCliente = req.user?.cliente_id || req.user?.tienda_id || 'default';
    const { data, error } = await supabase
      .from('productos_digitales')
      .select('id, tienda_id, titulo, descripcion, tipo, precio_ars, precio_usd, link_entrega, activo, created_at')
      .eq('tienda_id', idCliente)
      .eq('activo', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error al listar productos:', error.message);
      return res.status(500).json({ error: 'No se pudieron consultar los productos' });
    }

    return res.status(200).json(data || []);
  } catch (error) {
    console.error('Error interno al listar productos:', error);
    return res.status(500).json({ error: 'Error interno al consultar los productos' });
  }
};

export const listarTransacciones = async (req, res) => {
  try {
    const idCliente = req.user?.cliente_id || req.user?.tienda_id || 'default';
    const { data, error } = await supabase
      .from('transacciones')
      .select('*')
      .eq('cliente_id', idCliente)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error al listar transacciones:', error.message);
      return res.status(500).json({ error: 'No se pudieron consultar las transacciones' });
    }

    const transacciones = await Promise.all((data || []).map(async (transaccion) => {
      if (!transaccion.comprobante_path) return transaccion;

      const { data: signedUrl, error: signedUrlError } = await supabase.storage
        .from(PAYMENT_PROOF_BUCKET)
        .createSignedUrl(transaccion.comprobante_path, PAYMENT_PROOF_URL_TTL_SECONDS);

      if (signedUrlError) {
        console.error('No se pudo generar la vista previa del comprobante:', signedUrlError.message);
        throw new Error('No se pudo generar una URL segura para un comprobante');
      }

      if (!signedUrl?.signedUrl) throw new Error('Supabase no devolvió la URL segura del comprobante');
      return { ...transaccion, comprobante_url: signedUrl.signedUrl };
    }));

    return res.json(transacciones);
  } catch (error) {
    console.error('Error interno al listar transacciones:', error);
    return res.status(500).json({ error: 'Error interno al consultar las transacciones' });
  }
};

export const cambiarEstadoTransaccion = async (req, res) => {
  const idCliente = req.user?.cliente_id || req.user?.tienda_id || 'default';
  const transaccionId = req.params.id || req.body?.id;
  const { estado } = req.body || {};

  if (!transaccionId || !['approved', 'rejected'].includes(estado)) {
    return res.status(400).json({ error: 'Se requiere una transacción y estado approved o rejected' });
  }

  try {
    const { data, error } = await supabase
      .from('transacciones')
      .update({ estado })
      .eq('id', transaccionId)
      .eq('cliente_id', idCliente)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Error al cambiar el estado de la transacción:', error.message);
      return res.status(500).json({ error: 'No se pudo actualizar el estado de la transacción' });
    }
    if (!data) return res.status(404).json({ error: 'Transacción no encontrada' });

    return res.json({ status: 'success', data });
  } catch (error) {
    console.error('Error interno al cambiar estado de la transacción:', error);
    return res.status(500).json({ error: 'Error interno al actualizar la transacción' });
  }
};

export const crearProducto = async (req, res) => {
  const archivo = req.file;
  const {
    titulo,
    descripcion = '',
    tipo = 'ebook',
    precio_ars: precioArs,
    precio_usd: precioUsd,
    link_entrega: linkEntrega = '',
  } = req.body;
  const idCliente = req.user?.cliente_id || req.user?.tienda_id || 'default';
  const precioArsNumerico = Number(precioArs);
  const precioUsdNumerico = Number(precioUsd);
  const tiposPermitidos = ['ebook', 'curso', 'matricula'];

  if (
    typeof titulo !== 'string' || !titulo.trim()
    || typeof descripcion !== 'string'
    || !tiposPermitidos.includes(tipo)
    || !Number.isFinite(precioArsNumerico) || precioArsNumerico < 0
    || !Number.isFinite(precioUsdNumerico) || precioUsdNumerico < 0
    || (precioArsNumerico === 0 && precioUsdNumerico === 0)
    || (linkEntrega && !esUrlWebValida(linkEntrega))
    || (!archivo && !linkEntrega)
  ) {
    return res.status(400).json({ error: 'Se requieren título, tipo válido, al menos un precio mayor a cero y un link de entrega o PDF' });
  }

  if (archivo && !archivo.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    return res.status(400).json({ error: 'El archivo cargado no es un PDF válido' });
  }

  const archivoPath = archivo ? `${randomUUID()}.pdf` : null;
  let archivoSubido = false;

  try {
    if (archivo) {
      const { error: uploadError } = await supabase.storage
        .from(PRODUCT_BUCKET)
        .upload(archivoPath, archivo.buffer, {
          contentType: 'application/pdf',
          upsert: false,
        });

      if (uploadError) {
        console.error('Error al subir el ebook a Supabase Storage:', uploadError.message);
        return res.status(502).json({ error: 'No se pudo guardar el archivo PDF' });
      }
      archivoSubido = true;
    }

    const { data, error } = await supabase
      .from('productos_digitales')
      .insert([{
        tienda_id: idCliente,
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        tipo,
        precio_ars: precioArsNumerico,
        precio_usd: precioUsdNumerico,
        link_entrega: linkEntrega.trim(),
        activo: true,
        archivo_path: archivoPath,
      }])
      .select('id, tienda_id, titulo, descripcion, tipo, precio_ars, precio_usd, link_entrega, activo')
      .single();

    if (error) {
      console.error('Error al registrar el producto en Supabase:', error.message);
      if (archivoSubido && archivoPath) {
        const { error: cleanupError } = await supabase.storage.from(PRODUCT_BUCKET).remove([archivoPath]);
        if (cleanupError) {
          console.error('No se pudo eliminar el PDF tras fallar el registro:', cleanupError.message);
        }
      }
      return res.status(500).json({ error: 'No se pudo registrar el producto' });
    }

    return res.status(201).json({ status: 'success', producto: data });
  } catch (error) {
    console.error('Error al crear el producto:', error);
    if (archivoSubido && archivoPath) {
      const { error: cleanupError } = await supabase.storage.from(PRODUCT_BUCKET).remove([archivoPath]);
      if (cleanupError) {
        console.error('No se pudo eliminar el PDF tras fallar el registro:', cleanupError.message);
      }
    }
    return res.status(500).json({ error: 'Error interno al crear el producto' });
  }
};

export const obtenerProducto = async (req, res) => {
  try {
    const idCliente = req.user?.cliente_id || req.user?.tienda_id || 'default';
    let productoQuery = supabase
      .from('productos_digitales')
      .select('id, tienda_id, titulo, descripcion, tipo, precio_ars, precio_usd')
      .eq('id', req.params.id)
      .eq('activo', true);
    if (req.user) productoQuery = productoQuery.eq('tienda_id', idCliente);
    const { data, error } = await productoQuery.single();

    if (error || !data) {
      if (error?.code === 'PGRST116') {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }
      console.error('Error al consultar el producto:', error?.message);
      return res.status(500).json({ error: 'No se pudo consultar el producto' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Error interno al consultar el producto:', error);
    return res.status(500).json({ error: 'Error interno al consultar el producto' });
  }
};

export const generarUrlFirmadaDescarga = async (productoId, idCliente = 'default') => {
  const { data: producto, error: productoError } = await supabase
    .from('productos_digitales')
    .select('archivo_path, link_entrega')
    .eq('id', productoId)
    .eq('tienda_id', idCliente)
    .single();

  if (productoError || (!producto?.archivo_path && !producto?.link_entrega)) {
    throw new Error(`No se encontró el archivo del producto ${productoId}`);
  }

  if (producto.link_entrega) return producto.link_entrega;

  const { data, error } = await supabase.storage
    .from(PRODUCT_BUCKET)
    .createSignedUrl(producto.archivo_path, SIGNED_URL_TTL_SECONDS, {
      download: true,
    });

  if (error || !data?.signedUrl) {
    throw new Error(`No se pudo generar el enlace de descarga: ${error?.message || 'URL vacía'}`);
  }

  return data.signedUrl;
};

export const obtenerDescargaAprobada = async (req, res) => {
  try {
    const paymentId = req.params.paymentId;
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(paymentId)) {
      return res.status(400).json({ error: 'Identificador de pago inválido' });
    }

    const { data: transaccion, error: transaccionError } = await supabase
      .from('transacciones')
      .select('estado, pasarela, producto_id, cliente_id')
      .eq('payment_id', paymentId)
      .maybeSingle();

    if (transaccionError) {
      console.error('Error al comprobar la transacción aprobada:', transaccionError.message);
      return res.status(500).json({ error: 'No se pudo verificar el pago' });
    }

    if (!transaccion) {
      return res.status(202).json({ status: 'pending', error: 'El pago todavía no fue confirmado' });
    }

    if (transaccion.estado !== 'approved') {
      return res.status(202).json({ status: 'pending', error: 'El pago todavía no fue confirmado' });
    }

    let productoId = transaccion.producto_id;
    if (transaccion.pasarela !== 'binance') {
      if (!/^\d+$/.test(paymentId)) {
        return res.status(400).json({ error: 'Identificador de pago de Mercado Pago inválido' });
      }
      const payment = new Payment(mpClient);
      const paymentData = await payment.get({ id: paymentId });
      if (paymentData.status !== 'approved') {
        return res.status(403).json({ error: 'El pago no está aprobado en Mercado Pago' });
      }
      productoId = paymentData.external_reference || productoId;
    }

    if (!productoId) {
      return res.status(403).json({ error: 'El pago no corresponde a un producto aprobado' });
    }

    const signedUrl = await generarUrlFirmadaDescarga(productoId, transaccion.cliente_id || 'default');
    return res.json({
      status: 'success',
      download_url: signedUrl,
      expires_in: SIGNED_URL_TTL_SECONDS,
    });
  } catch (error) {
    console.error('Error al preparar la descarga aprobada:', error);
    return res.status(500).json({ error: 'No se pudo generar el enlace de descarga' });
  }
};
