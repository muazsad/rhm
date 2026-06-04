const { getSupabaseAdmin } = require('./server-clients');

async function recordPurchase({ sessionId, albumId, email, amount }) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('album_purchases')
    .upsert({
      session_id: sessionId,
      album_id: albumId,
      email: email || null,
      amount: amount || 0
    }, { onConflict: 'session_id' });

  if (error) throw error;
}

async function findPurchaseBySession(sessionId, albumId) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('album_purchases')
    .select('session_id, album_id, email, amount, created_at')
    .eq('session_id', sessionId)
    .eq('album_id', albumId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

module.exports = {
  findPurchaseBySession,
  recordPurchase
};
