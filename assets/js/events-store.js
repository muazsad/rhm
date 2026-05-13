(function (window) {
  var statusMap = {
    open: { label: 'Registration Open', cls: 'badge-open' },
    closed: { label: 'Registration Closed', cls: 'badge-closed' },
    soon: { label: 'Coming Soon', cls: 'badge-soon' }
  };

  var sportMap = {
    'flag-football': { label: 'Flag Football', icon: '🏈' },
    basketball: { label: 'Basketball', icon: '🏀' },
    soccer: { label: 'Soccer', icon: '⚽' },
    volleyball: { label: 'Volleyball', icon: '🏐' },
    other: { label: 'Other', icon: '🎯' }
  };

  function readyClient() {
    return window.RHM && window.RHM.getSupabaseClient ? window.RHM.getSupabaseClient() : null;
  }

  function formatDate(value) {
    if (!value) return '';
    return new Date(value + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function formatTime(value) {
    if (!value) return '';
    var clean = String(value).slice(0, 5);
    return new Date('1970-01-01T' + clean).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function normalizeEvent(record) {
    var status = statusMap[record.status] || statusMap.soon;
    var sport = sportMap[record.sport] || sportMap.other;
    return {
      id: record.id,
      title: record.title || record.name || '',
      sport: record.sport || 'other',
      sportLabel: sport.label,
      sportIcon: sport.icon,
      status: record.status || 'soon',
      statusLabel: status.label,
      statusClass: status.cls,
      date: record.event_date || record.date || '',
      dateLabel: formatDate(record.event_date || record.date),
      time: record.event_time || record.time || '',
      timeLabel: formatTime(record.event_time || record.time),
      location: record.location || '',
      description: record.description || ''
    };
  }

  async function listPublishedEvents() {
    var client = readyClient();
    if (!client) return [];

    var response = await client
      .from('events')
      .select('*')
      .eq('is_published', true)
      .order('event_date', { ascending: true });

    if (response.error) throw response.error;
    return (response.data || []).map(normalizeEvent);
  }

  async function listAdminEvents() {
    var client = readyClient();
    if (!client) return [];

    var response = await client
      .from('events')
      .select('*')
      .order('event_date', { ascending: true });

    if (response.error) throw response.error;
    return (response.data || []).map(normalizeEvent);
  }

  async function createEvent(input) {
    var client = readyClient();
    if (!client) throw new Error('Supabase is not configured.');

    var session = await client.auth.getSession();
    var userId = session.data.session && session.data.session.user ? session.data.session.user.id : null;
    var response = await client
      .from('events')
      .insert({
        title: input.title,
        sport: input.sport,
        status: input.status,
        event_date: input.date,
        event_time: input.time || null,
        location: input.location || null,
        description: input.description || null,
        is_published: true,
        created_by: userId,
        updated_by: userId
      })
      .select('*')
      .single();

    if (response.error) throw response.error;
    return normalizeEvent(response.data);
  }

  async function deleteEvent(id) {
    var client = readyClient();
    if (!client) throw new Error('Supabase is not configured.');

    var response = await client.from('events').delete().eq('id', id);
    if (response.error) throw response.error;
  }

  window.RHMEventsStore = {
    normalizeEvent: normalizeEvent,
    listPublishedEvents: listPublishedEvents,
    listAdminEvents: listAdminEvents,
    createEvent: createEvent,
    deleteEvent: deleteEvent
  };
})(window);
