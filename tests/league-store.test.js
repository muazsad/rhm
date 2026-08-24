const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadScript(rel, sandbox) {
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: rel });
  return sandbox;
}

function makeSandbox() {
  const store = new Map();
  const sb = {
    console,
    JSON,
    Number,
    Date,
    window: {},
    localStorage: {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); }
    }
  };
  sb.window = sb;
  return sb;
}

function loadLeagueStore(sb) {
  sb.window.RHM = null;
  return loadScript('assets/js/league-store.js', sb);
}

// vm.runInNewContext evaluates array/object literals in a separate realm, so
// they fail node:assert/strict's deepEqual (which checks prototype identity)
// against host-realm literals. Round-tripping through host JSON normalizes them.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('newLeague creates a draft league with empty state', () => {
  const sb = makeSandbox();
  loadLeagueStore(sb);
  const league = sb.window.RHMLeagueStore.newLeague({ name: 'Fall 2026', season: 'Fall 2026', startDate: '2026-08-30' });
  assert.equal(league.name, 'Fall 2026');
  assert.equal(league.status, 'draft');
  assert.deepEqual(plain(league.state.teams), []);
  assert.deepEqual(plain(league.state.games), []);
  assert.equal(league.state.playoffs.enabled, false);
});

test('saveLocalLeague inserts a new league', () => {
  const sb = makeSandbox();
  loadLeagueStore(sb);
  const store = sb.window.RHMLeagueStore;
  store.saveLocalLeague(store.newLeague({ name: 'A', startDate: '2026-01-01' }));
  assert.equal(store.listLocalLeagues().length, 1);
});

test('saveLocalLeague updates existing league by id', () => {
  const sb = makeSandbox();
  loadLeagueStore(sb);
  const store = sb.window.RHMLeagueStore;
  const league = store.newLeague({ name: 'Original', startDate: '2026-01-01' });
  store.saveLocalLeague(league);
  league.name = 'Updated';
  store.saveLocalLeague(league);
  const list = store.listLocalLeagues();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Updated');
});

test('deleteLocalLeague removes league by id', () => {
  const sb = makeSandbox();
  loadLeagueStore(sb);
  const store = sb.window.RHMLeagueStore;
  const a = store.newLeague({ name: 'A', startDate: '2026-01-01' });
  const b = store.newLeague({ name: 'B', startDate: '2026-01-02' });
  store.saveLocalLeague(a);
  store.saveLocalLeague(b);
  store.deleteLocalLeague(a.id);
  const list = store.listLocalLeagues();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, b.id);
});

test('loadLeagues falls back to localStorage when no Supabase client', async () => {
  const sb = makeSandbox();
  loadLeagueStore(sb);
  const store = sb.window.RHMLeagueStore;
  store.saveLocalLeague(store.newLeague({ name: 'A', startDate: '2026-01-01' }));
  const leagues = await store.loadLeagues();
  assert.equal(leagues.length, 1);
  assert.equal(leagues[0].name, 'A');
});

test('loadPublishedLeagues filters by status and sorts by startDate desc', async () => {
  const sb = makeSandbox();
  loadLeagueStore(sb);
  const store = sb.window.RHMLeagueStore;
  const draft = store.newLeague({ name: 'Draft', startDate: '2026-01-01' });
  const older = store.newLeague({ name: 'Older', startDate: '2026-01-01' });
  older.status = 'published';
  const newer = store.newLeague({ name: 'Newer', startDate: '2026-06-01' });
  newer.status = 'published';
  store.saveLocalLeague(draft);
  store.saveLocalLeague(older);
  store.saveLocalLeague(newer);
  const published = await store.loadPublishedLeagues();
  assert.equal(published.length, 2);
  assert.equal(published[0].name, 'Newer');
  assert.equal(published[1].name, 'Older');
});

test('leagueToStandingsConfig builds one group with all team names', () => {
  const sb = makeSandbox();
  loadLeagueStore(sb);
  const store = sb.window.RHMLeagueStore;
  const league = store.newLeague({ name: 'Fall League', startDate: '2026-08-30' });
  league.state.teams = [{ id: 't1', name: 'Team A' }, { id: 't2', name: 'Team B' }];
  const config = store.leagueToStandingsConfig(league);
  assert.equal(config.groups.length, 1);
  assert.deepEqual(plain(config.groups[0].teams), ['Team A', 'Team B']);
  assert.equal(config.rules.tiesAllowed, false);
});

test('leagueToStandingsConfig only includes final games as fixtures', () => {
  const sb = makeSandbox();
  loadLeagueStore(sb);
  const store = sb.window.RHMLeagueStore;
  const league = store.newLeague({ name: 'Fall League', startDate: '2026-08-30' });
  league.state.teams = [{ id: 't1', name: 'Team A' }, { id: 't2', name: 'Team B' }];
  league.state.games = [
    { id: 'g1', homeTeamId: 't1', awayTeamId: 't2', homeScore: 50, awayScore: 40, status: 'final' },
    { id: 'g2', homeTeamId: 't1', awayTeamId: 't2', homeScore: null, awayScore: null, status: 'scheduled' }
  ];
  const config = store.leagueToStandingsConfig(league);
  assert.equal(config.fixtures.length, 1);
  assert.equal(config.fixtures[0].teamA, 'Team A');
  assert.equal(config.fixtures[0].teamB, 'Team B');
  assert.equal(config.fixtures[0].scoreA, 50);
  assert.equal(config.fixtures[0].scoreB, 40);
  assert.equal(config.fixtures[0].groupId, 'league');
});
