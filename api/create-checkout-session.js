const { getPaidAlbum } = require('./_lib/albums');
const { getOrigin, methodNotAllowed, readJsonBody, sendJson } = require('./_lib/http');
const { getStripe } = require('./_lib/server-clients');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const { albumId } = await readJsonBody(req);
    const album = getPaidAlbum(albumId);
    if (!album || !album.amountCents) {
      return sendJson(res, 400, { error: 'Unknown or unavailable album' });
    }

    const origin = getOrigin(req);
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: album.currency || 'usd',
            unit_amount: album.amountCents,
            product_data: {
              name: album.title || `${album.id} photos`
            }
          },
          quantity: 1
        }
      ],
      success_url: `${origin}/photos.html?session_id={CHECKOUT_SESSION_ID}&album=${encodeURIComponent(album.id)}`,
      cancel_url: `${origin}/photos.html?album=${encodeURIComponent(album.id)}&checkout=cancelled`,
      metadata: { albumId: album.id }
    });

    return sendJson(res, 200, { url: session.url });
  } catch (error) {
    const status = error.statusCode || 500;
    return sendJson(res, status, { error: status === 500 ? 'Unable to create checkout session' : error.message });
  }
};
