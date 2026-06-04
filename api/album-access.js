const { getPaidAlbum } = require('./_lib/albums');
const { methodNotAllowed, sendJson } = require('./_lib/http');
const { verifyAccessToken } = require('./_lib/token');
const { listSignedAlbumImages } = require('./_lib/storage');

function readBearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const albumId = url.searchParams.get('album');
    const album = getPaidAlbum(albumId);
    if (!album) return sendJson(res, 400, { error: 'Unknown album' });

    const tokenPayload = verifyAccessToken(readBearerToken(req), album.id);
    if (!tokenPayload) return sendJson(res, 401, { error: 'Album access token is missing or expired' });

    const images = await listSignedAlbumImages(album);
    return sendJson(res, 200, { albumId: album.id, images });
  } catch (error) {
    return sendJson(res, 500, { error: 'Unable to load album access' });
  }
};
