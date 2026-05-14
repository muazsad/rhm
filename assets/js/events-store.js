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

  var defaultRegistrationQuestions = [
    { id: 'first_name', label: 'First Name', type: 'text', required: true, system: true },
    { id: 'last_name', label: 'Last Name', type: 'text', required: true, system: true },
    { id: 'email', label: 'Email address', type: 'email', required: true, system: true },
    { id: 'phone', label: 'Phone number', type: 'phone', required: true, system: true },
    { id: 'team_name', label: 'Team Name', type: 'text', required: true, system: true },
    {
      id: 'player_count',
      label: 'Total Number of Players (Max 5)(Min 3)',
      type: 'number',
      required: true,
      min: 3,
      max: 5,
      system: true
    },
    { id: 'player_names', label: 'List All Player Names', type: 'textarea', required: true, system: true },
    {
      id: 'agreement',
      label: 'I confirm all players are 16 or older. I understand that only Muslim players are allowed per team. I understand that my team is not fully registered until payment is received and confirmed. I agree to adhere to the rules and conduct expectations of the tournament. - NON REFUNDABLE',
      type: 'checkbox',
      required: true,
      system: true
    }
  ];

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

  function cloneQuestions(questions) {
    return JSON.parse(JSON.stringify(questions || []));
  }

  function normalizeQuestion(question, index) {
    var input = question || {};
    var id = input.id || ('question_' + Date.now() + '_' + index);
    var type = input.type || 'text';
    return {
      id: String(id).replace(/[^a-zA-Z0-9_-]/g, '_'),
      label: input.label || 'Question',
      type: type,
      required: input.required !== false,
      min: input.min === undefined || input.min === '' ? null : Number(input.min),
      max: input.max === undefined || input.max === '' ? null : Number(input.max),
      help: input.help || '',
      system: input.system === true
    };
  }

  function normalizeRegistration(registration) {
    var input = registration || {};
    var questions = Array.isArray(input.questions) && input.questions.length
      ? input.questions
      : defaultRegistrationQuestions;

    return {
      enabled: input.enabled === true,
      paymentRequired: input.paymentRequired === true,
      paymentLink: input.paymentLink || '',
      questions: cloneQuestions(questions).map(normalizeQuestion)
    };
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
      description: record.description || '',
      registration: normalizeRegistration(record.registration || record.registration_config)
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
        registration: normalizeRegistration(input.registration),
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

  async function submitRegistration(payload) {
    var client = readyClient();
    if (!client) return null;

    var response = await client.from('registrations').insert(payload).select('*').single();
    if (response.error) throw response.error;
    return response.data;
  }

  window.RHMEventsStore = {
    defaultRegistrationQuestions: cloneQuestions(defaultRegistrationQuestions),
    normalizeRegistration: normalizeRegistration,
    normalizeEvent: normalizeEvent,
    listPublishedEvents: listPublishedEvents,
    listAdminEvents: listAdminEvents,
    createEvent: createEvent,
    deleteEvent: deleteEvent,
    submitRegistration: submitRegistration
  };
})(window);
