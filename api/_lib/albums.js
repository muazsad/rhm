const PAID_ALBUMS = [
  {
    id: 'spring-classic-2026',
    title: 'Spring Classic 2026 Photos',
    amountCents: 500,
    currency: 'usd',
    storagePrefix: 'spring-classic-2026'
  }
];

function getPaidAlbum(albumId) {
  return PAID_ALBUMS.find(album => album.id === albumId) || null;
}

function listPaidAlbumIds() {
  return PAID_ALBUMS.map(album => album.id).sort();
}

module.exports = {
  getPaidAlbum,
  listPaidAlbumIds
};
