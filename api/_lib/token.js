const crypto = require('node:crypto');

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signPayload(payload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
}

function mintAccessToken({ albumId, sessionId, email }) {
  const secret = process.env.PHOTO_ACCESS_TOKEN_SECRET;
  if (!secret) throw new Error('PHOTO_ACCESS_TOKEN_SECRET is not configured');

  const ttl = Number(process.env.PHOTO_ACCESS_TOKEN_EXPIRES_SECONDS || 60 * 60 * 24 * 30);
  const payload = {
    albumId,
    sessionId,
    email: email || null,
    exp: Math.floor(Date.now() / 1000) + ttl
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${signPayload(encoded, secret)}`;
}

function verifyAccessToken(token, albumId) {
  const secret = process.env.PHOTO_ACCESS_TOKEN_SECRET;
  if (!secret || !token || !token.includes('.')) return null;

  const [encoded, signature] = token.split('.');
  const expected = signPayload(encoded, secret);
  const actual = Buffer.from(signature || '');
  const expectedBuffer = Buffer.from(expected);
  if (actual.length !== expectedBuffer.length || !crypto.timingSafeEqual(actual, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.albumId !== albumId) return null;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  mintAccessToken,
  verifyAccessToken
};
