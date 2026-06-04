const { getSupabaseAdmin } = require('./server-clients');

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

function isImageObject(name) {
  const extension = String(name).split('.').pop().toLowerCase();
  return IMAGE_EXTENSIONS.has(extension);
}

function parsePageOptions(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 40, 60));
  const offset = Math.max(0, Number(options.cursor) || 0);
  return { limit, offset };
}

async function listImageFiles(bucketClient, prefix, pageOptions) {
  const { data: files, error } = await bucketClient.list(prefix, {
    limit: pageOptions.limit,
    offset: pageOptions.offset,
    sortBy: { column: 'name', order: 'asc' }
  });

  if (error) throw error;
  return (files || [])
    .filter(file => file && file.name && !file.name.startsWith('.') && isImageObject(file.name));
}

async function listSignedAlbumImages(album, options = {}) {
  const supabase = getSupabaseAdmin();
  const bucket = process.env.PAID_ALBUMS_BUCKET || 'paid-albums';
  const expiresIn = Number(process.env.SIGNED_URL_EXPIRES_SECONDS || 3600);
  const pageOptions = parsePageOptions(options);
  const bucketClient = supabase.storage.from(bucket);
  const originalsPrefix = `${album.storagePrefix}/originals`;
  const thumbsPrefix = `${album.storagePrefix}/thumbs`;

  let files = await listImageFiles(bucketClient, thumbsPrefix, pageOptions);
  let usingThumbs = true;

  if (!files.length && pageOptions.offset === 0) {
    files = await listImageFiles(bucketClient, album.storagePrefix, pageOptions);
    usingThumbs = false;
  }

  const paths = files.flatMap(file => {
    if (!usingThumbs) return [`${album.storagePrefix}/${file.name}`];
    return [
      `${thumbsPrefix}/${file.name}`,
      `${originalsPrefix}/${file.name}`
    ];
  });

  if (!paths.length) {
    return { images: [], nextCursor: null };
  }

  const { data, error: signedError } = await supabase
    .storage
    .from(bucket)
    .createSignedUrls(paths, expiresIn);

  if (signedError) throw signedError;

  const signedUrls = (data || []).map(item => item && item.signedUrl);
  const images = files.map((file, index) => {
    const absoluteIndex = pageOptions.offset + index + 1;
    if (!usingThumbs) {
      return {
        thumbUrl: signedUrls[index],
        url: signedUrls[index],
        name: file.name,
        alt: `${album.id} photo ${absoluteIndex}`
      };
    }
    return {
      thumbUrl: signedUrls[index * 2],
      url: signedUrls[index * 2 + 1] || signedUrls[index * 2],
      name: file.name,
      alt: `${album.id} photo ${absoluteIndex}`
    };
  }).filter(image => image.thumbUrl || image.url);

  return {
    images,
    nextCursor: files.length === pageOptions.limit ? String(pageOptions.offset + pageOptions.limit) : null
  };
}

module.exports = {
  listSignedAlbumImages
};
