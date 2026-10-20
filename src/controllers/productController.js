import { randomUUID } from 'node:crypto';
import { supabase } from '../config/supabase.js';
import { Payment } from 'mercadopago';
import { mpClient } from '../config/mp.js';

const PRODUCT_BUCKET = 'ebooks-privados';
const SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;

export const crearProducto = async (req, res) => {
  const archivo = req.file;

  if (!archivo) {
    return res.status(400).json({ error: 'El archivo PDF es obligatorio' });
  }

  const { tienda_id: tiendaId, titulo, descripcion, precio_ars: precioArs, precio_usd: precioUsd } = req.body;
  const precioArsNumerico = Number(precioArs);
  const precioUsdNumerico = Number(precioUsd);

  if (
    typeof tiendaId !== 'string' || !tiendaId.trim()
    || typeof titulo !== 'string' || !titulo.trim()
    || typeof descripcion !== 'string'
    || !Number.isFinite(precioArsNumerico) || precioArsNumerico < 0
    || !Number.isFinite(precioUsdNumerico) || precioUsdNumerico < 0
  ) {
    return res.status(400).json({ error: 'Faltan campos válidos: tienda_id, titulo, descripcion, precio_ars y precio_usd' });
  }

  if (!archivo.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    return res.status(400).json({ error: 'El archivo cargado no es un PDF válido' });
  }

  const archivoPath = `${randomUUID()}.pdf`;
  let archivoSubido = false;

  try {
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
    const { data, error } = await supabase
      .from('productos')
      .insert([{
        tienda_id: tiendaId.trim(),
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        precio_ars: precioArsNumerico,
        precio_usd: precioUsdNumerico,
        archivo_path: archivoPath,
      }])
      .select('id, tienda_id, titulo, descripcion, precio_ars, precio_usd')
      .single();

    if (error) {
      console.error('Error al registrar el producto en Supabase:', error.message);
      const { error: cleanupError } = await supabase.storage.from(PRODUCT_BUCKET).remove([archivoPath]);
      if (cleanupError) {
        console.error('No se pudo eliminar el PDF tras fallar el registro:', cleanupError.message);
      }
      return res.status(500).json({ error: 'No se pudo registrar el producto' });
    }

    return res.status(201).json({ status: 'success', producto: data });
  } catch (error) {
    console.error('Error al crear el producto:', error);
    if (archivoSubido) {
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
    const { data, error } = await supabase
      .from('productos')
      .select('id, titulo, descripcion, precio_ars, precio_usd')
      .eq('id', req.params.id)
      .single();

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

export const generarUrlFirmadaDescarga = async (productoId) => {
  const { data: producto, error: productoError } = await supabase
    .from('productos')
    .select('archivo_path')
    .eq('id', productoId)
    .single();

  if (productoError || !producto?.archivo_path) {
    throw new Error(`No se encontró el archivo del producto ${productoId}`);
  }

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
    if (!/^\d+$/.test(paymentId)) {
      return res.status(400).json({ error: 'Identificador de pago inválido' });
    }

    const { data: transaccion, error: transaccionError } = await supabase
      .from('transacciones')
      .select('estado')
      .eq('payment_id', paymentId)
      .eq('estado', 'approved')
      .maybeSingle();

    if (transaccionError) {
      console.error('Error al comprobar la transacción aprobada:', transaccionError.message);
      return res.status(500).json({ error: 'No se pudo verificar el pago' });
    }

    if (!transaccion) {
      return res.status(202).json({ status: 'pending', error: 'El pago todavía no fue confirmado por el webhook' });
    }

    const payment = new Payment(mpClient);
    const paymentData = await payment.get({ id: paymentId });
    const productoId = paymentData.external_reference;

    if (paymentData.status !== 'approved' || !productoId) {
      return res.status(403).json({ error: 'El pago no corresponde a un producto aprobado' });
    }

    const signedUrl = await generarUrlFirmadaDescarga(productoId);
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
