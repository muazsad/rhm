(function (window) {
  var LS = 'RHM_tournament';

  function readyClient() {
    return window.RHM && window.RHM.getSupabaseClient ? window.RHM.getSupabaseClient() : null;
  }

  function loadLocal() {
    try {
      var value = window.localStorage.getItem(LS);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      return null;
    }
  }

  function saveLocal(state) {
    window.localStorage.setItem(LS, JSON.stringify(state));
  }

  async function loadTournamentState() {
    var client = readyClient();
    if (!client) return loadLocal();

    var response = await client
      .from('tournament_state')
      .select('state')
      .eq('id', 'active')
      .eq('is_active', true)
      .maybeSingle();

    if (response.error) throw response.error;
    return response.data ? response.data.state : null;
  }

  async function saveTournamentState(state) {
    var client = readyClient();
    if (!client) {
      saveLocal(state);
      return state;
    }

    var session = await client.auth.getSession();
    var userId = session.data.session && session.data.session.user ? session.data.session.user.id : null;
    var response = await client
      .from('tournament_state')
      .upsert({
        id: 'active',
        is_active: true,
        state: state,
        updated_by: userId
      })
      .select('state')
      .single();

    if (response.error) throw response.error;
    saveLocal(state);
    return response.data.state;
  }

  async function clearTournamentState() {
    var client = readyClient();
    window.localStorage.removeItem(LS);
    if (!client) return;

    var response = await client
      .from('tournament_state')
      .update({ is_active: false })
      .eq('id', 'active');

    if (response.error) throw response.error;
  }

  window.RHMTournamentStore = {
    loadTournamentState: loadTournamentState,
    saveTournamentState: saveTournamentState,
    clearTournamentState: clearTournamentState
  };
})(window);
