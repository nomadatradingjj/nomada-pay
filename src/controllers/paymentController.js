import { MercadoPagoConfig, Preference } from 'mercadopago';
import { mpClient } from '../config/mp.js';
import { supabase } from '../config/supabase.js';

export const crearCobro = async (req, res) => {
  try {
    const { producto_id: productoId, vendedorAccessToken, comisionPorcentaje = 0.015 } = req.body;
    let { titulo, precio } = req.body;

    if (productoId) {
      const { data: producto, error: productoError } = await supabase
        .from('productos')
        .select('titulo, precio_ars')
        .eq('id', productoId)
        .single();

      if (productoError || !producto) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      titulo = producto.titulo;
      precio = producto.precio_ars;
    }

    const precioNumerico = Number(precio);

    if (typeof titulo !== 'string' || !titulo.trim() || !Number.isFinite(precioNumerico) || precioNumerico <= 0) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: titulo o precio' });
    }

    const accessTokenVendedor = typeof vendedorAccessToken === 'string'
      ? vendedorAccessToken.trim()
      : '';
    const tokenUsado = accessTokenVendedor || mpClient.accessToken || '';
    if (!tokenUsado || tokenUsado.startsWith('TEST-')) {
      return res.status(503).json({ error: 'Se requiere un access token de Mercado Pago de producción' });
    }

    const marketplaceFee = Math.round(precioNumerico * Number(comisionPorcentaje));
    const preferenceClient = accessTokenVendedor
      ? new MercadoPagoConfig({ accessToken: accessTokenVendedor, options: mpClient.options })
      : mpClient;
    const preference = new Preference(preferenceClient);

    // 1. Configurar Webhook solo si es una URL HTTPS pública
    const baseUrl = (process.env.BASE_URL || 'https://nomada-pay.onrender.com').replace(/\/+$/, '');
    const webhookUrl = (process.env.WEBHOOK_URL || baseUrl).replace(/\/+$/, '');
    const esUrlPublica = webhookUrl.startsWith('https://');

    const bodyData = {
      items: [
        {
          title: titulo.trim(),
          unit_price: precioNumerico,
          quantity: 1,
          currency_id: 'ARS',
        },
      ],
      back_urls: {
        success: `${baseUrl}/prueba.html?status=success`,
        failure: `${baseUrl}/prueba.html?status=failure`,
        pending: `${baseUrl}/prueba.html?status=pending`,
      },
      auto_return: 'approved',
      ...(productoId && { external_reference: String(productoId) }),
    };

    // Solo agregar notification_url si tenemos una dirección HTTPS válida
    if (esUrlPublica) {
      bodyData.notification_url = webhookUrl.includes('/api/webhooks/mercadopago')
        ? webhookUrl 
        : `${webhookUrl}/api/webhooks/mercadopago`;
    }

    // Solo agregar marketplace_fee si realmente viene un vendedor distinto por OAuth
    if (accessTokenVendedor && marketplaceFee > 0) {
      bodyData.marketplace_fee = marketplaceFee;
    }

    const response = await preference.create({ body: bodyData });
    console.log('Respuesta de Mercado Pago:', response);

    if (!response.id || !response.init_point) {
      throw new Error('Mercado Pago no devolvió init_point para el checkout de producción');
    }

    // 2. Registro de la transacción en Supabase
    try {
      const { data, error } = await supabase
        .from('transacciones')
        .insert([
          {
            preference_id: response.id,
            titulo: titulo.trim(),
            monto: precioNumerico,
            comision: marketplaceFee,
            estado: 'pending',
            pasarela: 'mercadopago'
          }
        ])
        .select();

      if (error) {
        console.error('⚠️ Error al registrar en Supabase:', error.message);
      } else if (data && data.length > 0) {
        console.log('✅ Transacción registrada en Supabase ID:', data[0].id);
      }
    } catch (dbError) {
      console.error('⚠️ Excepción al intentar guardar en Supabase:', dbError.message);
    }

    return res.json({
      status: 'success',
      id: response.id,
      init_point: response.init_point,
      comision_calculada: marketplaceFee
    });

  } catch (error) {
    console.error('Error al crear preferencia:', error);
    return res.status(500).json({ error: 'Error al generar el cobro', detalles: error.message });
  }
};