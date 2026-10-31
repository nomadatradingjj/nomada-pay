import { MercadoPagoConfig, Preference } from 'mercadopago';
import { mpClient } from '../config/mp.js';
import { supabase } from '../config/supabase.js';
import { calculateCommissionAmount } from '../services/commissionService.js';

export const crearCobro = async (req, res) => {
  try {
    const {
      producto_id: productoId,
      vendedorAccessToken,
      return_url: returnUrl,
      email_comprador: emailComprador,
      plan_id: planId,
    } = req.body;
    let { titulo, precio } = req.body;
    const idCliente = req.user?.cliente_id || req.user?.tienda_id || 'default';
    let clientePagoId = idCliente;

    if (productoId) {
      let productoQuery = supabase
        .from('productos_digitales')
        .select('titulo, precio_ars, tienda_id')
        .eq('id', productoId)
        .eq('activo', true);
      if (req.user) productoQuery = productoQuery.eq('tienda_id', idCliente);
      const { data: producto, error: productoError } = await productoQuery.single();

      if (productoError || !producto) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      titulo = producto.titulo;
      precio = producto.precio_ars;
      clientePagoId = producto.tienda_id || idCliente;
    }

    const precioNumerico = Number(precio);

    if (typeof titulo !== 'string' || !titulo.trim() || !Number.isFinite(precioNumerico) || precioNumerico <= 0) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: titulo o precio' });
    }

    const comisionMonto = await calculateCommissionAmount(clientePagoId, precioNumerico);
    const accessTokenVendedor = typeof vendedorAccessToken === 'string'
      ? vendedorAccessToken.trim()
      : '';
    const tokenUsado = accessTokenVendedor || mpClient.accessToken || '';
    if (!tokenUsado || tokenUsado.startsWith('TEST-')) {
      return res.status(503).json({ error: 'Se requiere un access token de Mercado Pago de producción' });
    }

    const preferenceClient = accessTokenVendedor
      ? new MercadoPagoConfig({ accessToken: accessTokenVendedor, options: mpClient.options })
      : mpClient;
    const preference = new Preference(preferenceClient);

    // 1. Configurar Webhook solo si es una URL HTTPS pública
    const baseUrl = (process.env.BASE_URL || 'https://nomada-pay.onrender.com').replace(/\/+$/, '');
    const webhookUrl = (process.env.WEBHOOK_URL || baseUrl).replace(/\/+$/, '');
    const esUrlPublica = webhookUrl.startsWith('https://');
    const originUrl = returnUrl || req.headers.origin || req.headers.referer || 'https://www.nomadatrading-arg.com';

    const bodyData = {
      items: [
        {
          title: titulo.trim(),
          unit_price: precioNumerico,
          quantity: 1,
          currency_id: 'ARS',
        },
      ],
      payer: {
        email: emailComprador,
      },
      back_urls: {
        success: originUrl,
        failure: originUrl,
        pending: originUrl,
      },
      auto_return: 'approved',
      ...(planId || productoId ? { external_reference: String(planId || productoId) } : {}),
    };

    // Solo agregar notification_url si tenemos una dirección HTTPS válida
    if (esUrlPublica) {
      bodyData.notification_url = webhookUrl.includes('/api/webhooks/mercadopago')
        ? webhookUrl 
        : `${webhookUrl}/api/webhooks/mercadopago`;
    }

    // Solo agregar marketplace_fee si realmente viene un vendedor distinto por OAuth
    if (accessTokenVendedor && comisionMonto > 0) {
      bodyData.marketplace_fee = comisionMonto;
    }

    const response = await preference.create({ body: bodyData });
    console.log('Respuesta de Mercado Pago:', response);

    if (!response.id || !response.init_point) {
      throw new Error('Mercado Pago no devolvió init_point para el checkout de producción');
    }

    // 2. Registro de la transacción en Supabase
    const { data, error } = await supabase
      .from('transacciones')
      .insert([{
        preference_id: response.id,
        cliente_id: clientePagoId,
        producto_id: productoId || null,
        titulo: titulo.trim(),
        monto: precioNumerico,
        comision: comisionMonto,
        comision_monto: comisionMonto,
        estado: 'pending',
        pasarela: 'mercadopago',
      }])
      .select()
      .single();

    if (error) {
      console.error('Error al registrar la transacción en Supabase:', error.message);
      return res.status(500).json({ error: 'No se pudo registrar la transacción' });
    }
    console.log('Transacción registrada en Supabase ID:', data.id);

    return res.status(200).json({
      init_point: response.init_point,
      preference_id: response.id
    });

  } catch (error) {
    console.error('Error al crear preferencia:', error);
    return res.status(500).json({ error: 'Error al generar el cobro', detalles: error.message });
  }
};