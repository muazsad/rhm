const PAID_ALBUMS = [
  {
    id: 'ocky-flag-football-2026',
    title: 'Ocky Flag Football 2026 Photos',
    amountCents: 500,
    currency: 'usd',
    storagePrefix: 'Ocky Flag Football 2026'
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
