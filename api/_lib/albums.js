const PAID_ALBUMS = [
  {
    id: 'ocky-flag-football-2026',
    aliases: ['spring-classic-2026'],
    title: 'Ocky Flag Football 2026 Photos',
    amountCents: 500,
    currency: 'usd',
    storagePrefix: 'Ocky Flag Football 2026'
  },
  {
    id: 'rhm-2026-basketball-tournament',
    aliases: [],
    title: 'RHM 2026 Basketball Tournament Photos',
    amountCents: 300,
    currency: 'usd',
    storagePrefix: 'RHM 2026 Basketball Tournament'
  }
];

function getPaidAlbum(albumId) {
  return PAID_ALBUMS.find(album => album.id === albumId || (album.aliases || []).includes(albumId)) || null;
}

function listPaidAlbumIds() {
  return PAID_ALBUMS.map(album => album.id).sort();
}

module.exports = {
  getPaidAlbum,
  listPaidAlbumIds
};
