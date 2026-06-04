const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
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
