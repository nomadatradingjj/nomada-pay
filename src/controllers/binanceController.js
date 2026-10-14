import crypto from 'crypto';
import { supabase } from '../config/supabase.js';

function generarFirmaBinance(timestamp, nonce, bodyStr, secretKey) {
  const payload = `${timestamp}\n${nonce}\n${bodyStr}\n`;
  return crypto
    .createHmac('sha512', secretKey)
    .update(payload)
    .digest('hex')
    .toUpperCase();
}

export const crearCobroBinance = async (req, res) => {
  try {
    const { titulo, precio } = req.body;

    if (!titulo || !precio) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: titulo o precio' });
    }

    const apiKey = process.env.BINANCE_PAY_KEY;
    const apiSecret = process.env.BINANCE_PAY_SECRET;

    if (!apiKey || !apiSecret) {
      return res.status(500).json({ error: 'Faltan credenciales de Binance Pay en el .env' });
    }

    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex');

    // Cuerpo oficial de la orden V2 para Binance Pay
    const orderBody = {
      env: { terminalType: 'WEB' },
      merchantTradeNo: `ORD-${Date.now()}`,
      orderAmount: Number(precio).toFixed(2),
      currency: 'USDT',
      goods: {
        goodsType: '02',
        goodsCategory: 'Z000',
        referenceGoodsId: 'sub-vip',
        goodsName: titulo
      }
    };

    const bodyStr = JSON.stringify(orderBody);
    const signature = generarFirmaBinance(timestamp, nonce, bodyStr, apiSecret);

    // Petición REAL a la API de Binance Pay
    const response = await fetch('https://bpay.binanceapi.com/binancepay/openapi/v2/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'BinancePay-Timestamp': timestamp,
        'BinancePay-Nonce': nonce,
        'BinancePay-Certificate-SN': apiKey,
        'BinancePay-Signature': signature
      },
      body: bodyStr
    });

    const data = await response.json();

    // Si Binance rechaza por IP o credenciales, devuelve error directo
    if (data.status !== 'SUCCESS') {
      console.error('❌ Rechazado por Binance API:', data);
      return res.status(400).json({ 
        error: 'Binance Pay rechazó la orden', 
        detalles: data.errorMessage || data 
      });
    }

    // Registrar la orden aprobada por Binance en Supabase
    const { data: dbData, error: dbError } = await supabase
      .from('transacciones')
      .insert([
        {
          preference_id: data.data.prepayId,
          titulo: titulo,
          monto: Number(precio),
          comision: 0,
          estado: 'pending',
          pasarela: 'binance'
        }
      ])
      .select();

    if (dbError) {
      console.error('⚠️ Error al guardar en Supabase:', dbError.message);
    } else {
      console.log('✅ Orden REAL de Binance registrada en Supabase:', dbData[0].id);
    }

    // Devolver la URL REAL de checkout de Binance
    return res.json({
      status: 'success',
      checkoutUrl: data.data.checkoutUrl,
      qrcodeLink: data.data.qrcodeLink,
      prepayId: data.data.prepayId
    });

  } catch (error) {
    console.error('Error en controlador Binance:', error);
    return res.status(500).json({ error: 'Error interno al procesar pago cripto' });
  }
};