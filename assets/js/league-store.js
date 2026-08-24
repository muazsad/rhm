(function (window) {
  var LS_LEAGUES = 'RHM_leagues';

  function readyClient() {
    return window.RHM && window.RHM.getSupabaseClient ? window.RHM.getSupabaseClient() : null;
  }

  // ── localStorage layer ──────────────────────────────────────────────────

  function listLocalLeagues() {
    try {
      var value = window.localStorage.getItem(LS_LEAGUES);
      return value ? JSON.parse(value) : [];
    } catch (error) {
      return [];
    }
  }

  function saveLocalLeagues(list) {
    window.localStorage.setItem(LS_LEAGUES, JSON.stringify(list));
  }

  function saveLocalLeague(league) {
    var list = listLocalLeagues();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === league.id) { idx = i; break; }
    }
    if (idx >= 0) {
      list[idx] = league;
    } else {
      list.push(league);
    }
    saveLocalLeagues(list);
  }

  function deleteLocalLeague(id) {
    var list = listLocalLeagues().filter(function (l) { return l.id !== id; });
    saveLocalLeagues(list);
  }

  // ── normalization ───────────────────────────────────────────────────────

  function emptyState() {
    return { teams: [], games: [], playoffs: { enabled: false, rounds: [] } };
  }

  function normalizeLeague(record) {
    var state = record.state || emptyState();
    return {
      id: record.id,
      name: record.name || 'Untitled League',
      season: record.season || '',
      sport: record.sport || 'basketball',
      startDate: record.start_date || record.startDate || '',
      status: record.status || 'draft',
      state: {
        teams: state.teams || [],
        games: state.games || [],
        playoffs: state.playoffs || { enabled: false, rounds: [] }
      },
      createdAt: record.created_at || record.createdAt || null,
      updatedAt: record.updated_at || record.updatedAt || null
    };
  }

  function newLeague(input) {
    return normalizeLeague({
      id: 'league-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      name: input.name,
      season: input.season || '',
      sport: input.sport || 'basketball',
      start_date: input.startDate || '',
      status: 'draft',
      state: emptyState()
    });
  }

  // ── read ─────────────────────────────────────────────────────────────────

  async function loadLeagues() {
    var client = readyClient();
    if (!client) return listLocalLeagues().map(normalizeLeague);

    var response = await client
      .from('leagues')
      .select('*')
      .order('start_date', { ascending: false });

    if (response.error) throw response.error;
    return (response.data || []).map(normalizeLeague);
  }

  async function loadLeague(id) {
    var client = readyClient();
    if (!client) {
      var local = listLocalLeagues().filter(function (l) { return l.id === id; })[0];
      return local ? normalizeLeague(local) : null;
    }

    var response = await client
      .from('leagues')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (response.error) throw response.error;
    return response.data ? normalizeLeague(response.data) : null;
  }

  async function loadPublishedLeagues() {
    var client = readyClient();
    if (!client) {
      return listLocalLeagues()
        .map(normalizeLeague)
        .filter(function (l) { return l.status === 'published'; })
        .sort(function (a, b) { return String(b.startDate).localeCompare(String(a.startDate)); });
    }

    var response = await client
      .from('leagues')
      .select('*')
      .eq('status', 'published')
      .order('start_date', { ascending: false });

    if (response.error) throw response.error;
    return (response.data || []).map(normalizeLeague);
  }

  // ── write ────────────────────────────────────────────────────────────────

  async function saveLeague(league) {
    var client = readyClient();
    if (!client) {
      saveLocalLeague(league);
      return league;
    }

    var session = await client.auth.getSession();
    var userId = session.data.session && session.data.session.user ? session.data.session.user.id : null;
    var response = await client
      .from('leagues')
      .upsert({
        id: league.id,
        name: league.name,
        season: league.season,
        sport: league.sport,
        start_date: league.startDate || null,
        status: league.status,
        state: league.state,
        updated_by: userId
      })
      .select('*')
      .single();

    if (response.error) throw response.error;
    var saved = normalizeLeague(response.data);
    saveLocalLeague(saved);
    return saved;
  }

  async function setLeagueStatus(id, status) {
    var league = await loadLeague(id);
    if (!league) throw new Error('League not found');
    league.status = status;
    return saveLeague(league);
  }

  function publishLeague(id) { return setLeagueStatus(id, 'published'); }
  function unpublishLeague(id) { return setLeagueStatus(id, 'draft'); }
  function archiveLeague(id) { return setLeagueStatus(id, 'archived'); }

  async function deleteLeague(id) {
    var client = readyClient();
    deleteLocalLeague(id);
    if (!client) return;

    var response = await client.from('leagues').delete().eq('id', id);
    if (response.error) throw response.error;
  }

  // ── standings adapter ───────────────────────────────────────────────────

  function leagueToStandingsConfig(league) {
    var teams = league.state.teams || [];
    var games = league.state.games || [];
    var byId = {};
    teams.forEach(function (t) { byId[t.id] = t.name; });

    var fixtures = games
      .filter(function (g) { return g.status === 'final'; })
      .map(function (g) {
        return {
          phase: 'group',
          groupId: 'league',
          teamA: byId[g.homeTeamId],
          teamB: byId[g.awayTeamId],
          scoreA: g.homeScore,
          scoreB: g.awayScore
        };
      });

    return {
      groups: [{ id: 'league', name: league.name, teams: teams.map(function (t) { return t.name; }) }],
      fixtures: fixtures,
      rules: { winPoints: 1, drawPoints: 0, lossPoints: 0, tiesAllowed: false }
    };
  }

  window.RHMLeagueStore = {
    emptyState: emptyState,
    normalizeLeague: normalizeLeague,
    newLeague: newLeague,
    listLocalLeagues: listLocalLeagues,
    saveLocalLeague: saveLocalLeague,
    deleteLocalLeague: deleteLocalLeague,
    loadLeagues: loadLeagues,
    loadLeague: loadLeague,
    loadPublishedLeagues: loadPublishedLeagues,
    saveLeague: saveLeague,
    publishLeague: publishLeague,
    unpublishLeague: unpublishLeague,
    archiveLeague: archiveLeague,
    deleteLeague: deleteLeague,
    leagueToStandingsConfig: leagueToStandingsConfig
  };
})(window);
