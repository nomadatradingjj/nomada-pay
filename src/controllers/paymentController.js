import { Preference } from 'mercadopago';
import { mpClient } from '../config/mp.js';
import { supabase } from '../config/supabase.js';

export const crearCobro = async (req, res) => {
  try {
    const { titulo, precio, vendedorAccessToken, comisionPorcentaje = 0.015 } = req.body;

    if (!titulo || !precio) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: titulo o precio' });
    }

    const marketplaceFee = Math.round(Number(precio) * Number(comisionPorcentaje));
    const preference = new Preference(mpClient);

    // 1. Configurar Webhook solo si es una URL HTTPS pública (Ngrok / Localtunnel o Producción)
    const webhookUrl = process.env.WEBHOOK_URL || process.env.BASE_URL;
    const esUrlPublica = webhookUrl && webhookUrl.startsWith('https://');

    const bodyData = {
      items: [
        {
          title: titulo,
          unit_price: Number(precio),
          quantity: 1,
          currency_id: 'ARS',
        },
      ],
      back_urls: {
        success: `${process.env.BASE_URL || 'http://localhost:3000'}/prueba.html?status=success`,
        failure: `${process.env.BASE_URL || 'http://localhost:3000'}/prueba.html?status=failure`,
        pending: `${process.env.BASE_URL || 'http://localhost:3000'}/prueba.html?status=pending`,
      },
    };

    // Solo agregar notification_url si tenemos una dirección HTTPS válida
    if (esUrlPublica) {
      bodyData.notification_url = webhookUrl.includes('/api/webhooks/mercadopago') 
        ? webhookUrl 
        : `${webhookUrl}/api/webhooks/mercadopago`;
    }

    // Solo agregar marketplace_fee si realmente viene un vendedor distinto por OAuth
    if (vendedorAccessToken && marketplaceFee > 0) {
      bodyData.marketplace_fee = marketplaceFee;
    }

    const requestOptions = vendedorAccessToken ? { accessToken: vendedorAccessToken } : {};
    const response = await preference.create({ body: bodyData, requestOptions });

    // 2. Registro de la transacción en Supabase
    try {
      const { data, error } = await supabase
        .from('transacciones')
        .insert([
          {
            preference_id: response.id,
            titulo: titulo,
            monto: Number(precio),
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
      sandbox_init_point: response.sandbox_init_point,
      comision_calculada: marketplaceFee
    });

  } catch (error) {
    console.error('Error al crear preferencia:', error);
    return res.status(500).json({ error: 'Error al generar el cobro', detalles: error.message });
  }
};