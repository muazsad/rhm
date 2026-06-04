const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function mockModule(relativePath, exports) {
  const resolved = require.resolve(path.join(root, relativePath));
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports
  };
  return resolved;
}

function mockJsonResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value) {
      this.body = value;
    },
    json() {
      return JSON.parse(this.body);
    }
  };
}

test('photos page is data-driven and includes the required album sections', () => {
  const html = read('photos.html');

  [
    'assets/js/albums.js',
    'assets/js/photos.js',
    'id="featured-albums"',
    'id="past-albums"',
    'id="past-empty"',
    'No past event albums yet',
    'class="active">Photos'
  ].forEach(text => assert.ok(html.includes(text), `${text} missing from photos page`));

  assert.equal(html.includes('price_'), false, 'Stripe price IDs must not be shipped in page HTML');
});

test('album browser config exposes display data only', () => {
  const albums = read('assets/js/albums.js');

  [
    'ocky-flag-football-2026',
    'section: "featured"',
    'locked: true',
    'price: "$5"',
    'section: "past"'
  ].forEach(text => assert.ok(albums.includes(text), `${text} missing from albums config`));

  assert.equal(albums.includes('price_'), false, 'Stripe price IDs belong server-side only');
  assert.equal(albums.includes('SUPABASE'), false, 'Supabase secrets/config do not belong in album config');
});

test('server album catalog maps album IDs to server-held checkout amounts', () => {
  delete require.cache[require.resolve('../api/_lib/albums')];
  const { getPaidAlbum, listPaidAlbumIds } = require('../api/_lib/albums');

  assert.deepEqual(listPaidAlbumIds(), ['ocky-flag-football-2026']);
  assert.equal(getPaidAlbum('ocky-flag-football-2026').amountCents, 500);
  assert.equal(getPaidAlbum('ocky-flag-football-2026').currency, 'usd');
  assert.equal(getPaidAlbum('ocky-flag-football-2026').storagePrefix, 'Ocky Flag Football 2026');
  assert.equal(getPaidAlbum('spring-classic-2026').id, 'ocky-flag-football-2026');
  assert.equal(getPaidAlbum('missing-album'), null);

  delete require.cache[require.resolve('../api/_lib/albums')];
});

test('photos API endpoints are scaffolded with Stripe and Supabase server SDKs', () => {
  [
    'api/create-checkout-session.js',
    'api/verify-session.js',
    'api/album-access.js',
    'api/stripe-webhook.js'
  ].forEach(file => assert.ok(fs.existsSync(path.join(root, file)), `${file} missing`));

  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies.stripe, 'stripe dependency missing');
  assert.ok(pkg.dependencies['@supabase/supabase-js'], 'supabase-js dependency missing');
});

test('verify-session still returns an access token when purchase logging or photo loading fails', async () => {
  const mocked = [
    mockModule('api/_lib/albums.js', {
      getPaidAlbum: () => ({
        id: 'ocky-flag-football-2026',
        title: 'Ocky Flag Football 2026 Photos',
        amountCents: 500,
        currency: 'usd',
        storagePrefix: 'Ocky Flag Football 2026'
      })
    }),
    mockModule('api/_lib/server-clients.js', {
      getStripe: () => ({
        checkout: {
          sessions: {
            retrieve: async () => ({
              id: 'cs_paid',
              payment_status: 'paid',
              metadata: { albumId: 'ocky-flag-football-2026' },
              customer_details: { email: 'paid@example.com' },
              amount_total: 500
            })
          }
        }
      })
    }),
    mockModule('api/_lib/purchases.js', {
      recordPurchase: async () => {
        throw new Error('table missing');
      }
    }),
    mockModule('api/_lib/storage.js', {
      listSignedAlbumImages: async (_album, options) => {
        assert.equal(options.limit, '40');
        throw new Error('folder missing');
      }
    }),
    mockModule('api/_lib/token.js', {
      mintAccessToken: () => 'signed-token'
    })
  ];

  delete require.cache[require.resolve('../api/verify-session')];
  const handler = require('../api/verify-session');
  const res = mockJsonResponse();

  await handler({
    method: 'GET',
    url: '/api/verify-session?session_id=cs_paid&album=ocky-flag-football-2026',
    headers: { host: 'example.com' }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().token, 'signed-token');
  assert.deepEqual(res.json().images, []);
  assert.ok(res.json().warnings.includes('purchase_log_failed'));
  assert.ok(res.json().warnings.includes('photo_load_failed'));

  mocked.forEach(resolved => delete require.cache[resolved]);
  delete require.cache[require.resolve('../api/verify-session')];
});

test('album-access trusts a valid signed token without requiring a purchase row', async () => {
  const mocked = [
    mockModule('api/_lib/albums.js', {
      getPaidAlbum: () => ({
        id: 'ocky-flag-football-2026',
        storagePrefix: 'Ocky Flag Football 2026'
      })
    }),
    mockModule('api/_lib/token.js', {
      verifyAccessToken: () => ({
        albumId: 'ocky-flag-football-2026',
        sessionId: 'cs_paid'
      })
    }),
    mockModule('api/_lib/storage.js', {
      listSignedAlbumImages: async (_album, options) => {
        assert.deepEqual(options, { cursor: '40', limit: '20' });
        return {
          images: [{ thumbUrl: 'https://signed.example/thumb.jpg', url: 'https://signed.example/photo.jpg', alt: 'Photo' }],
          nextCursor: '60'
        };
      }
    })
  ];

  delete require.cache[require.resolve('../api/album-access')];
  const handler = require('../api/album-access');
  const res = mockJsonResponse();

  await handler({
    method: 'GET',
    url: '/api/album-access?album=ocky-flag-football-2026&cursor=40&limit=20',
    headers: {
      host: 'example.com',
      authorization: 'Bearer signed-token'
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().images, [{ thumbUrl: 'https://signed.example/thumb.jpg', url: 'https://signed.example/photo.jpg', alt: 'Photo' }]);
  assert.equal(res.json().nextCursor, '60');

  mocked.forEach(resolved => delete require.cache[resolved]);
  delete require.cache[require.resolve('../api/album-access')];
});

test('storage lists a bounded thumbnail page and pairs thumbnails with originals', async () => {
  const calls = [];
  const mocked = [
    mockModule('api/_lib/server-clients.js', {
      getSupabaseAdmin: () => ({
        storage: {
          from: () => ({
            list: async (prefix, options) => {
              calls.push({ prefix, options });
              assert.equal(prefix, 'Ocky Flag Football 2026/thumbs');
              assert.equal(options.limit, 2);
              assert.equal(options.offset, 2);
              return {
                data: [
                  { name: '267A4542.jpg' },
                  { name: '267A4543.jpg' }
                ],
                error: null
              };
            },
            createSignedUrls: async paths => ({
              data: paths.map(pathName => ({ signedUrl: `https://signed.example/${encodeURIComponent(pathName)}` })),
              error: null
            })
          })
        }
      })
    })
  ];

  delete require.cache[require.resolve('../api/_lib/storage')];
  const { listSignedAlbumImages } = require('../api/_lib/storage');
  const page = await listSignedAlbumImages({
    id: 'ocky-flag-football-2026',
    storagePrefix: 'Ocky Flag Football 2026'
  }, { cursor: '2', limit: '2' });

  assert.equal(calls.length, 1);
  assert.equal(page.nextCursor, '4');
  assert.equal(page.images.length, 2);
  assert.ok(page.images[0].thumbUrl.includes('thumbs'));
  assert.ok(page.images[0].url.includes('originals'));

  mocked.forEach(resolved => delete require.cache[resolved]);
  delete require.cache[require.resolve('../api/_lib/storage')];
});
