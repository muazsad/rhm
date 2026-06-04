const { getPaidAlbum } = require('./_lib/albums');
const { methodNotAllowed, readRawBody, sendJson } = require('./_lib/http');
const { recordPurchase } = require('./_lib/purchases');
const { getStripe } = require('./_lib/server-clients');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const signature = req.headers['stripe-signature'];
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return sendJson(res, 500, { error: 'Stripe webhook secret is not configured' });
  }

  try {
    const rawBody = await readRawBody(req);
    const event = getStripe().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const album = getPaidAlbum(session.metadata && session.metadata.albumId);
      if (album && session.payment_status === 'paid') {
        await recordPurchase({
          sessionId: session.id,
          albumId: album.id,
          email: session.customer_details && session.customer_details.email,
          amount: session.amount_total
        });
      }
    }

    return sendJson(res, 200, { received: true });
  } catch (error) {
    return sendJson(res, 400, { error: 'Webhook verification failed' });
  }
};
