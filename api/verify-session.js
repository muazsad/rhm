const { getPaidAlbum } = require('./_lib/albums');
const { sendJson, methodNotAllowed } = require('./_lib/http');
const { mintAccessToken } = require('./_lib/token');
const { recordPurchase } = require('./_lib/purchases');
const { getStripe } = require('./_lib/server-clients');
const { listSignedAlbumImages } = require('./_lib/storage');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const sessionId = url.searchParams.get('session_id');
    if (!sessionId) return sendJson(res, 400, { error: 'Missing session_id' });

    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    const albumId = session.metadata && session.metadata.albumId;
    const album = getPaidAlbum(albumId);
    if (!album) return sendJson(res, 400, { error: 'Unknown album' });
    if (session.payment_status !== 'paid') return sendJson(res, 402, { error: 'Payment has not completed' });

    const email = session.customer_details && session.customer_details.email;
    await recordPurchase({
      sessionId: session.id,
      albumId: album.id,
      email,
      amount: session.amount_total
    });

    const token = mintAccessToken({ albumId: album.id, sessionId: session.id, email });
    const images = await listSignedAlbumImages(album);

    return sendJson(res, 200, { token, albumId: album.id, images });
  } catch (error) {
    return sendJson(res, 500, { error: 'Unable to verify checkout session' });
  }
};
