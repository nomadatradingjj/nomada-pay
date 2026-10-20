import { Payment } from 'mercadopago';
import { mpClient } from '../config/mp.js';
import { supabase } from '../config/supabase.js';

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

          if (paymentData.preference_id) {
            const { data: transaccion, error } = await supabase
              .from('transacciones')
              .update({ payment_id: String(paymentId), estado: 'approved' })
              .eq('preference_id', paymentData.preference_id)
              .select('id')
              .maybeSingle();

            if (error) {
              console.error('Error al confirmar la transacción en Supabase:', error.message);
              return res.status(500).send('No se pudo confirmar la transacción');
            }
            if (!transaccion) {
              console.error(`No se encontró la transacción para la preferencia ${paymentData.preference_id}`);
              return res.status(500).send('No se encontró la transacción');
            }
          }
        }
      }
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Error procesando Webhook:', error);
    return res.status(500).send('Error');
  }
};