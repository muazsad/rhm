const { getSupabaseAdmin } = require('./server-clients');

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

function isImageObject(name) {
  const extension = String(name).split('.').pop().toLowerCase();
  return IMAGE_EXTENSIONS.has(extension);
}

async function listSignedAlbumImages(album) {
  const supabase = getSupabaseAdmin();
  const bucket = process.env.PAID_ALBUMS_BUCKET || 'paid-albums';
  const expiresIn = Number(process.env.SIGNED_URL_EXPIRES_SECONDS || 3600);

  const { data: files, error: listError } = await supabase
    .storage
    .from(bucket)
    .list(album.storagePrefix, {
      limit: 100,
      sortBy: { column: 'name', order: 'asc' }
    });

  if (listError) throw listError;

  const paths = (files || [])
    .filter(file => file && file.name && !file.name.startsWith('.') && isImageObject(file.name))
    .map(file => `${album.storagePrefix}/${file.name}`);

  if (!paths.length) return [];

  const { data, error: signedError } = await supabase
    .storage
    .from(bucket)
    .createSignedUrls(paths, expiresIn);

  if (signedError) throw signedError;

  return (data || [])
    .filter(item => item.signedUrl)
    .map((item, index) => ({
      url: item.signedUrl,
      alt: `${album.id} photo ${index + 1}`
    }));
}

module.exports = {
  listSignedAlbumImages
};
