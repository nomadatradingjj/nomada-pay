import { Payment } from 'mercadopago';
import { mpClient } from '../config/mp.js';

export const recibirWebhookMP = async (req, res) => {
  try {
    const { query } = req;
    const topic = query.topic || query.type;

    if (topic === 'payment') {
      const paymentId = query['data.id'] || query.id;
      
      if (paymentId) {
        const payment = new Payment(mpClient);
        const paymentData = await payment.get({ id: paymentId });

        console.log(`📌 Notificación de Pago #${paymentId}:`);
        console.log(`   Estado: ${paymentData.status}`);
        console.log(`   Monto Total: $${paymentData.transaction_amount}`);
        console.log(`   Comisión Retenida: $${paymentData.marketplace_fee}`);

        if (paymentData.status === 'approved') {
          console.log('✅ Pago APROBADO: Actualizando inventario...');
        }
      }
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Error procesando Webhook:', error);
    return res.status(500).send('Error');
  }
};