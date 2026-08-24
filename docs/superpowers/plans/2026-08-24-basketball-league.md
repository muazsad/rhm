# Basketball League Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public "League" section (standings, schedule, teams, playoffs) and an admin dashboard to manage the RHM Fall 2026 Basketball League, supporting multiple seasons over time.

**Architecture:** A new `leagues` Supabase table stores one JSON `state` blob per league (teams/games/playoffs), following the existing `tournament_state` dual-write (Supabase + localStorage) pattern via a new `assets/js/league-store.js` module. Standings are computed live by feeding league data into the existing `tournament-standings.js` engine — no new standings math. Two new pages: `admin-league.html` (CRUD) and `league.html` (public display), styled to match `admin-events.html` / `tournament-live.html`.

**Tech Stack:** Vanilla JS (IIFE modules, no build step), Supabase JS client v2, `node --test` with `node:vm` sandboxing for unit tests (existing convention).

**Reference spec:** `docs/superpowers/specs/2026-08-24-basketball-league-design.md`

---

## Task 1: Supabase schema — `leagues` table

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Add the `leagues` table, trigger, and RLS policies**

Insert the following block into `supabase/schema.sql` immediately after the `tournament_state` table definition (after the block ending `constraint tournament_state_singleton check (id = 'active')\n);` and before the `set_updated_at` function):

```sql
create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  season text,
  sport text not null default 'basketball',
  start_date date,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  state jsonb not null default '{"teams":[],"games":[],"playoffs":{"enabled":false,"rounds":[]}}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Then, immediately after the existing `drop trigger if exists set_tournament_state_updated_at ...` block (which ends with `for each row execute function public.set_updated_at();`), add:

```sql
drop trigger if exists set_leagues_updated_at on public.leagues;
create trigger set_leagues_updated_at
before update on public.leagues
for each row execute function public.set_updated_at();
```

Then, immediately after `alter table public.tournament_state enable row level security;`, add:

```sql
alter table public.leagues enable row level security;
```

Finally, immediately after the last `tournament_state` policy block (ends with `using (public.is_admin())\nwith check (public.is_admin());` for "Admins can manage tournament state"), add:

```sql
drop policy if exists "Public can read published leagues" on public.leagues;
create policy "Public can read published leagues"
on public.leagues
for select
to anon, authenticated
using (status = 'published');

drop policy if exists "Admins can manage leagues" on public.leagues;
create policy "Admins can manage leagues"
on public.leagues
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
```

- [ ] **Step 2: Verify the file is valid SQL by eye**

Run: `grep -c "create table if not exists public.leagues" supabase/schema.sql`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add leagues table and RLS policies to schema"
```

---

## Task 2: `league-store.js` — core CRUD + localStorage layer (TDD)

**Files:**
- Create: `assets/js/league-store.js`
- Test: `tests/league-store.test.js`

- [ ] **Step 1: Write the failing tests for league creation and localStorage CRUD**

Create `tests/league-store.test.js` with this content:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/league-store.test.js`
Expected: FAIL — `assets/js/league-store.js` does not exist (`Cannot find module` / `ENOENT`)

- [ ] **Step 3: Create `assets/js/league-store.js` with the core CRUD implementation**

```js
(function (window) {
  var LS_LEAGUES = 'RHM_leagues';

  function readyClient() {
    return window.RHM && window.RHM.getSupabaseClient ? window.RHM.getSupabaseClient() : null;
  }

  // The leagues.id column is Postgres uuid, so ids generated client-side
  // (for a new league, or when Supabase isn't configured) must be valid UUIDs.
  function generateUUID() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
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
      id: generateUUID(),
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
    deleteLeague: deleteLeague
  };
})(window);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/league-store.test.js`
Expected: PASS — 6/6 tests green

- [ ] **Step 5: Commit**

```bash
git add assets/js/league-store.js tests/league-store.test.js
git commit -m "Add league-store.js with CRUD and localStorage fallback (TDD)"
```

---

## Task 3: `league-store.js` — standings adapter (TDD)

**Files:**
- Modify: `assets/js/league-store.js`
- Modify: `tests/league-store.test.js`

- [ ] **Step 1: Append failing tests for `leagueToStandingsConfig`**

Append to `tests/league-store.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/league-store.test.js`
Expected: FAIL — `store.leagueToStandingsConfig is not a function`

- [ ] **Step 3: Add `leagueToStandingsConfig` to `assets/js/league-store.js`**

Insert this function above the `window.RHMLeagueStore = {` assignment:

```js
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
```

And add `leagueToStandingsConfig: leagueToStandingsConfig,` to the `window.RHMLeagueStore` export object (alongside `deleteLeague: deleteLeague,`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/league-store.test.js`
Expected: PASS — 8/8 tests green

- [ ] **Step 5: Commit**

```bash
git add assets/js/league-store.js tests/league-store.test.js
git commit -m "Add leagueToStandingsConfig adapter for tournament-standings.js reuse"
```

---

## Task 4: `league-store.js` — CSV schedule import (TDD)

**Files:**
- Modify: `assets/js/league-store.js`
- Modify: `tests/league-store.test.js`

- [ ] **Step 1: Append failing tests for `parseLeagueScheduleCSV`**

Append to `tests/league-store.test.js`. First add this helper near the top, right after `loadLeagueStore`:

```js
function loadLeagueStoreWithScheduleImport(sb) {
  sb.window.RHM = null;
  loadScript('assets/js/schedule-import.js', sb);
  loadScript('assets/js/league-store.js', sb);
  return sb;
}
```

Then append the tests:

```js
test('parseLeagueScheduleCSV parses valid rows into games', () => {
  const sb = makeSandbox();
  loadLeagueStoreWithScheduleImport(sb);
  const store = sb.window.RHMLeagueStore;
  const csv = 'Date,Time,Location,Home Team,Away Team\n' +
    '2026-08-30,14:00,Court 1,Team A,Team B\n' +
    '2026-09-06,15:30,Court 2,Team C,Team D\n';
  const result = store.parseLeagueScheduleCSV(csv, []);
  assert.equal(result.errors.length, 0);
  assert.equal(result.games.length, 2);
  assert.equal(result.games[0].date, '2026-08-30');
  assert.equal(result.games[0].time, '14:00');
  assert.equal(result.games[0].homeTeamName, 'Team A');
  assert.equal(result.games[0].awayTeamName, 'Team B');
  assert.equal(result.games[0].status, 'scheduled');
  assert.equal(result.games[0].homeScore, null);
});

test('parseLeagueScheduleCSV marks games with both scores as final', () => {
  const sb = makeSandbox();
  loadLeagueStoreWithScheduleImport(sb);
  const store = sb.window.RHMLeagueStore;
  const csv = 'Date,Time,Location,Home Team,Away Team,Home Score,Away Score\n' +
    '2026-08-30,14:00,Court 1,Team A,Team B,50,40\n';
  const result = store.parseLeagueScheduleCSV(csv, []);
  assert.equal(result.games[0].status, 'final');
  assert.equal(result.games[0].homeScore, 50);
  assert.equal(result.games[0].awayScore, 40);
});

test('parseLeagueScheduleCSV flags a row missing a date', () => {
  const sb = makeSandbox();
  loadLeagueStoreWithScheduleImport(sb);
  const store = sb.window.RHMLeagueStore;
  const csv = 'Date,Time,Location,Home Team,Away Team\n' +
    ',14:00,Court 1,Team A,Team B\n';
  const result = store.parseLeagueScheduleCSV(csv, []);
  assert.equal(result.games.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /missing a date/);
});

test('parseLeagueScheduleCSV flags a badly formatted date', () => {
  const sb = makeSandbox();
  loadLeagueStoreWithScheduleImport(sb);
  const store = sb.window.RHMLeagueStore;
  const csv = 'Date,Time,Location,Home Team,Away Team\n' +
    '08/30/2026,14:00,Court 1,Team A,Team B\n';
  const result = store.parseLeagueScheduleCSV(csv, []);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /YYYY-MM-DD/);
});

test('parseLeagueScheduleCSV reports team names not in the existing roster', () => {
  const sb = makeSandbox();
  loadLeagueStoreWithScheduleImport(sb);
  const store = sb.window.RHMLeagueStore;
  const csv = 'Date,Time,Location,Home Team,Away Team\n' +
    '2026-08-30,14:00,Court 1,Team A,Team B\n';
  const result = store.parseLeagueScheduleCSV(csv, [{ id: 't1', name: 'Team A' }]);
  assert.deepEqual(plain(result.newTeamNames), ['Team B']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/league-store.test.js`
Expected: FAIL — `store.parseLeagueScheduleCSV is not a function`

- [ ] **Step 3: Add `parseLeagueScheduleCSV` to `assets/js/league-store.js`**

Insert this function above the `window.RHMLeagueStore = {` assignment (after the standings adapter):

```js
  // ── CSV schedule import ─────────────────────────────────────────────────

  function findColumn(header, keywords) {
    for (var k = 0; k < keywords.length; k++) {
      for (var i = 0; i < header.length; i++) {
        if (header[i].indexOf(keywords[k]) >= 0) return i;
      }
    }
    return -1;
  }

  function parseLeagueScheduleCSV(text, teams) {
    var rows = window.RHMScheduleImport.parseCSV(text);
    var games = [];
    var errors = [];

    if (rows.length < 2) {
      return { games: games, newTeamNames: [], errors: errors };
    }

    var header = rows[0].map(function (c) { return String(c || '').trim().toLowerCase(); });
    var colDate = findColumn(header, ['date']);
    var colTime = findColumn(header, ['time']);
    var colLocation = findColumn(header, ['location', 'court', 'field']);
    var colHome = findColumn(header, ['home']);
    var colAway = findColumn(header, ['away']);
    var colHomeScore = findColumn(header, ['home score']);
    var colAwayScore = findColumn(header, ['away score']);

    var knownNames = (teams || []).map(function (t) { return t.name; });
    var newTeamNames = [];

    rows.slice(1).forEach(function (row, ri) {
      var rowNumber = ri + 2;
      var date = colDate >= 0 ? String(row[colDate] || '').trim() : '';
      var time = colTime >= 0 ? String(row[colTime] || '').trim() : '';
      var location = colLocation >= 0 ? String(row[colLocation] || '').trim() : '';
      var home = colHome >= 0 ? String(row[colHome] || '').trim() : '';
      var away = colAway >= 0 ? String(row[colAway] || '').trim() : '';
      var homeScoreRaw = colHomeScore >= 0 ? String(row[colHomeScore] || '').trim() : '';
      var awayScoreRaw = colAwayScore >= 0 ? String(row[colAwayScore] || '').trim() : '';

      if (!date) {
        errors.push({ rowNumber: rowNumber, message: 'Row is missing a date' });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        errors.push({ rowNumber: rowNumber, message: 'Date "' + date + '" is not in YYYY-MM-DD format' });
        return;
      }
      if (!home || !away) {
        errors.push({ rowNumber: rowNumber, message: 'Row is missing a home or away team name' });
        return;
      }

      [home, away].forEach(function (name) {
        var known = knownNames.some(function (n) { return n.toLowerCase() === name.toLowerCase(); });
        if (!known && newTeamNames.indexOf(name) < 0) newTeamNames.push(name);
      });

      var hasScores = homeScoreRaw !== '' && awayScoreRaw !== '';
      games.push({
        date: date,
        time: time,
        location: location,
        homeTeamName: home,
        awayTeamName: away,
        homeScore: hasScores ? Number(homeScoreRaw) : null,
        awayScore: hasScores ? Number(awayScoreRaw) : null,
        status: hasScores ? 'final' : 'scheduled'
      });
    });

    return { games: games, newTeamNames: newTeamNames, errors: errors };
  }
```

And add `parseLeagueScheduleCSV: parseLeagueScheduleCSV` to the `window.RHMLeagueStore` export object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/league-store.test.js`
Expected: PASS — 13/13 tests green

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `node --test tests/*.test.js`
Expected: PASS — all existing suites plus `league-store.test.js` green

- [ ] **Step 6: Commit**

```bash
git add assets/js/league-store.js tests/league-store.test.js
git commit -m "Add CSV schedule import to league-store.js (TDD)"
```

---

## Task 5: `admin-dashboard.html` — add League Manager card

**Files:**
- Modify: `admin-dashboard.html:203-223`

- [ ] **Step 1: Add a third dashboard card**

In `admin-dashboard.html`, insert a new `.dash-card` immediately after the closing `</div>` of the "Tournament Bracket" card (after line 221, before the closing `</div>` of `.cards` on line 223):

```html
      <div class="dash-card">
        <div class="card-icon">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a12 12 0 0 1 0 18M12 3a12 12 0 0 0 0 18M3 12h18"/></svg>
        </div>
        <div class="card-title">League Manager</div>
        <div class="card-desc">Create and manage league teams, schedules, standings, and playoffs across seasons.</div>
        <a href="admin-league.html" class="card-btn">Go to League</a>
      </div>
```

Also update the `.cards` grid CSS (around line 106-110) from `grid-template-columns: 1fr 1fr;` to `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));` so three cards wrap cleanly instead of leaving an orphaned column.

- [ ] **Step 2: Manually verify in a browser**

Open `admin-dashboard.html` locally (or via the dev preview) and confirm three cards render, with "Go to League" linking to `admin-league.html` (404 is expected until Task 6 lands).

- [ ] **Step 3: Commit**

```bash
git add admin-dashboard.html
git commit -m "Add League Manager card to admin dashboard"
```

---

## Task 6: `admin-league.html` — page skeleton, CSS, list view, Details + Teams tabs

**Files:**
- Create: `admin-league.html`

This task creates the full file with all CSS needed for every tab (Schedule/Standings/Playoffs
tabs get their CSS now too, so Tasks 7-9 only add HTML/JS, not more CSS), but only wires up the
league list view plus the Details and Teams tabs. Schedule, Standings, and Playoffs tab bodies
are empty placeholder `<div>`s until Tasks 7-9.

- [ ] **Step 1: Create `admin-league.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RHM Admin — League Manager</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap" rel="stylesheet">
  <style>
    :root {
      --green: #2db84b;
      --black: #0a0a0a;
      --white: #f2f2ee;
      --muted: #888;
      --surface: #111;
      --surface2: #161616;
      --border: #1e1e1e;
      --border2: #2a2a2a;
      --red: #e05555;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body { background: var(--black); color: var(--white); font-family: 'DM Sans', sans-serif; min-height: 100vh; }

    /* ── NAVBAR ── */
    .admin-nav { background: var(--surface); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 2.5rem; height: 64px; }
    .nav-left { display: flex; align-items: center; gap: 1rem; }
    .nav-left a { display: flex; align-items: center; }
    .nav-left img { height: 36px; width: auto; }
    .nav-label { font-size: 11px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); border-left: 1px solid var(--border2); padding-left: 1rem; }
    .nav-right a { font-size: 12px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); text-decoration: none; }
    .nav-right a:hover { color: var(--green); }

    /* ── MAIN ── */
    .main { max-width: 1100px; margin: 0 auto; padding: 3rem 2rem 5rem; }
    .page-label { font-size: 11px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--green); margin-bottom: 0.6rem; }
    .page-headline { font-family: 'Bebas Neue', sans-serif; font-size: 3rem; letter-spacing: 0.06em; color: var(--white); margin-bottom: 2rem; line-height: 1; }

    /* ── BUTTONS ── */
    .btn-primary { background: var(--green); color: #fff; border: none; font-family: 'Bebas Neue', sans-serif; font-size: 1rem; letter-spacing: 0.08em; padding: 0.65rem 1.4rem; cursor: pointer; }
    .btn-primary:hover { background: #27a343; }
    .btn-outline { background: none; border: 1px solid var(--border2); color: var(--white); font-family: 'Bebas Neue', sans-serif; font-size: 0.95rem; letter-spacing: 0.08em; padding: 0.6rem 1.2rem; cursor: pointer; }
    .btn-outline:hover { border-color: var(--green); color: var(--green); }
    .btn-small { background: none; border: 1px solid var(--border2); color: var(--muted); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; padding: 0.4rem 0.8rem; cursor: pointer; }
    .btn-small:hover { border-color: var(--green); color: var(--green); }
    .btn-danger { background: none; border: 1px solid var(--red); color: var(--red); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; padding: 0.4rem 0.8rem; cursor: pointer; }
    .btn-danger:hover { background: rgba(224,85,85,0.1); }

    /* ── LEAGUE LIST ── */
    .list-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .league-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.25rem; }
    .league-card { background: var(--surface); border: 1px solid var(--border); padding: 1.5rem; cursor: pointer; transition: border-color 0.2s; }
    .league-card:hover { border-color: var(--green); }
    .league-card-name { font-family: 'Bebas Neue', sans-serif; font-size: 1.4rem; letter-spacing: 0.05em; margin-bottom: 0.4rem; }
    .league-card-meta { font-size: 12px; color: var(--muted); margin-bottom: 0.75rem; }
    .status-badge { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 0.25rem 0.6rem; }
    .status-draft { background: rgba(136,136,136,0.15); color: var(--muted); }
    .status-published { background: rgba(45,184,75,0.15); color: var(--green); }
    .status-archived { background: rgba(136,136,136,0.08); color: #555; }
    .empty-note { color: var(--muted); font-size: 13px; padding: 2rem 0; }

    /* ── NEW LEAGUE FORM ── */
    .new-league-panel { background: var(--surface); border: 1px solid var(--border); padding: 1.5rem; margin-bottom: 1.5rem; display: none; }
    .new-league-panel.active { display: block; }
    .field { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 1rem; }
    .field label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    .field input, .field select { background: var(--black); border: 1px solid var(--border2); color: var(--white); font-family: 'DM Sans', sans-serif; font-size: 14px; padding: 0.6rem 0.75rem; }
    .field input:focus, .field select:focus { outline: none; border-color: var(--green); }
    .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; }

    /* ── EDITOR ── */
    #view-editor { display: none; }
    #view-editor.active { display: block; }
    #view-list.hidden { display: none; }
    .editor-topbar { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem; }
    .editor-topbar-left { display: flex; align-items: center; gap: 0.75rem; }
    .back-link { color: var(--muted); text-decoration: none; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; }
    .back-link:hover { color: var(--green); }
    .editor-actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }

    .tab-nav { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 1.75rem; overflow-x: auto; }
    .tab-btn { background: none; border: none; border-bottom: 2px solid transparent; color: var(--muted); font-family: 'Bebas Neue', sans-serif; font-size: 1.05rem; letter-spacing: 0.08em; padding: 0.85rem 1.4rem; cursor: pointer; white-space: nowrap; }
    .tab-btn:hover { color: var(--white); }
    .tab-btn.active { color: var(--green); border-bottom-color: var(--green); }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* ── TEAMS ── */
    .team-row { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; background: var(--surface); border: 1px solid var(--border); margin-bottom: 0.5rem; }
    .team-row-name { font-size: 14px; }
    .team-row-warning { color: #d9a441; font-size: 11px; margin-left: 0.75rem; }
    .add-team-row { display: flex; gap: 0.75rem; margin-top: 1rem; }
    .add-team-row input { flex: 1; }

    /* ── SCHEDULE ── */
    .sched-tbl { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 1.5rem; }
    .sched-tbl th { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); padding: 0.5rem; text-align: left; border-bottom: 1px solid var(--border); }
    .sched-tbl td { padding: 0.55rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
    .sched-tbl input[type="number"] { width: 55px; background: var(--black); border: 1px solid var(--border2); color: var(--white); padding: 0.3rem; }
    .status-pill { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 0.2rem 0.5rem; }
    .status-pill.scheduled { background: rgba(136,136,136,0.15); color: var(--muted); }
    .status-pill.final { background: rgba(45,184,75,0.15); color: var(--green); }
    .status-pill.postponed { background: rgba(224,85,85,0.15); color: var(--red); }

    .csv-import-row { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin: 1.5rem 0; padding: 1rem; background: var(--surface2); border: 1px solid var(--border); }
    .csv-file-label { background: var(--border2); color: var(--white); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; padding: 0.55rem 1rem; cursor: pointer; }
    .csv-import-hint { color: var(--muted); font-size: 11px; }
    .csv-import-errors { background: rgba(224,85,85,0.08); border: 1px solid var(--red); padding: 0.75rem 1rem; margin-top: 0.75rem; }
    .csv-import-errors .cie-title { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--red); margin-bottom: 0.4rem; }
    .csv-import-errors ul { padding-left: 1.1rem; font-size: 12px; line-height: 1.6; }

    /* ── STANDINGS ── */
    .stg-tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
    .stg-tbl th { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); padding: 0.5rem; text-align: left; border-bottom: 1px solid var(--border); }
    .stg-tbl td { padding: 0.55rem 0.5rem; border-bottom: 1px solid var(--border); }
    .stg-tbl tr:nth-child(even) td { background: var(--surface2); }
    .stg-rank { font-weight: 700; color: #555; }
    .diff-p { color: var(--green); }
    .diff-n { color: var(--red); }

    /* ── PLAYOFFS ── */
    .round-block { margin-bottom: 2rem; }
    .round-title { font-family: 'Bebas Neue', sans-serif; font-size: 1.3rem; letter-spacing: 0.06em; color: var(--green); margin-bottom: 0.75rem; }
    .matchup-card { background: var(--surface); border: 1px solid var(--border); padding: 1rem; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; }
    .matchup-teams { display: flex; align-items: center; gap: 0.5rem; font-size: 14px; }
    .matchup-teams select { background: var(--black); border: 1px solid var(--border2); color: var(--white); padding: 0.4rem; }
    .matchup-teams input[type="number"] { width: 50px; background: var(--black); border: 1px solid var(--border2); color: var(--white); padding: 0.3rem; }
    .matchup-winner { color: var(--green); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }

    @media (max-width: 700px) {
      .row-2, .row-3 { grid-template-columns: 1fr; }
      .page-headline { font-size: 2.25rem; }
    }
  </style>
</head>
<body>

  <nav class="admin-nav">
    <div class="nav-left">
      <a href="index.html" aria-label="RHM home"><img src="RHM-Logo.png" alt="RHM Logo"></a>
      <span class="nav-label">Admin Panel</span>
    </div>
    <div class="nav-right"><a href="admin-login.html" data-admin-logout>Logout</a></div>
  </nav>

  <main class="main">
    <div class="page-label">Admin › League</div>
    <h1 class="page-headline">League Manager</h1>

    <!-- ═══════ LIST VIEW ═══════ -->
    <div id="view-list">
      <div class="list-toolbar">
        <div id="league-count" class="csv-import-hint">Loading leagues…</div>
        <button class="btn-primary" type="button" onclick="toggleNewLeagueForm()">+ New League</button>
      </div>

      <div class="new-league-panel" id="new-league-panel">
        <div class="row-3">
          <div class="field">
            <label for="nl-name">League Name</label>
            <input type="text" id="nl-name" placeholder="RHM Fall 2026 Basketball League">
          </div>
          <div class="field">
            <label for="nl-season">Season</label>
            <input type="text" id="nl-season" placeholder="Fall 2026">
          </div>
          <div class="field">
            <label for="nl-start-date">Start Date</label>
            <input type="date" id="nl-start-date">
          </div>
        </div>
        <button class="btn-primary" type="button" onclick="createLeague()">Create League</button>
      </div>

      <div class="league-grid" id="league-grid"></div>
    </div>

    <!-- ═══════ EDITOR VIEW ═══════ -->
    <div id="view-editor">
      <div class="editor-topbar">
        <div class="editor-topbar-left">
          <a href="#" class="back-link" onclick="showListView(); return false;">← All Leagues</a>
        </div>
        <div class="editor-actions">
          <span id="editor-status-badge"></span>
          <button class="btn-outline" type="button" id="publish-btn" onclick="togglePublish()"></button>
          <button class="btn-outline" type="button" onclick="archiveCurrentLeague()">Archive</button>
          <button class="btn-danger" type="button" id="delete-btn" onclick="deleteCurrentLeague()">Delete</button>
          <button class="btn-primary" type="button" onclick="saveCurrentLeague()">Save</button>
        </div>
      </div>

      <div class="tab-nav">
        <button class="tab-btn active" data-tab="details" onclick="switchTab('details')">Details</button>
        <button class="tab-btn" data-tab="teams" onclick="switchTab('teams')">Teams</button>
        <button class="tab-btn" data-tab="schedule" onclick="switchTab('schedule')">Schedule</button>
        <button class="tab-btn" data-tab="standings" onclick="switchTab('standings')">Standings</button>
        <button class="tab-btn" data-tab="playoffs" onclick="switchTab('playoffs')">Playoffs</button>
      </div>

      <!-- DETAILS -->
      <div class="tab-panel active" data-panel="details">
        <div class="row-3">
          <div class="field">
            <label for="ed-name">League Name</label>
            <input type="text" id="ed-name" oninput="updateLeagueField('name', this.value)">
          </div>
          <div class="field">
            <label for="ed-season">Season</label>
            <input type="text" id="ed-season" oninput="updateLeagueField('season', this.value)">
          </div>
          <div class="field">
            <label for="ed-start-date">Start Date</label>
            <input type="date" id="ed-start-date" oninput="updateLeagueField('startDate', this.value)">
          </div>
        </div>
        <div class="field" style="max-width:300px;">
          <label for="ed-sport">Sport</label>
          <select id="ed-sport" onchange="updateLeagueField('sport', this.value)">
            <option value="basketball">Basketball</option>
            <option value="soccer">Soccer</option>
            <option value="volleyball">Volleyball</option>
            <option value="flag-football">Flag Football</option>
          </select>
        </div>
      </div>

      <!-- TEAMS -->
      <div class="tab-panel" data-panel="teams">
        <div id="teams-list"></div>
        <div class="add-team-row">
          <input type="text" id="new-team-name" placeholder="Team name">
          <button class="btn-primary" type="button" onclick="addTeam()">Add Team</button>
        </div>
      </div>

      <!-- SCHEDULE (filled in Task 7) -->
      <div class="tab-panel" data-panel="schedule">
        <div id="schedule-tab-body"></div>
      </div>

      <!-- STANDINGS (filled in Task 8) -->
      <div class="tab-panel" data-panel="standings">
        <div id="standings-tab-body"></div>
      </div>

      <!-- PLAYOFFS (filled in Task 9) -->
      <div class="tab-panel" data-panel="playoffs">
        <div id="playoffs-tab-body"></div>
      </div>
    </div>
  </main>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="assets/js/supabase-config.js"></script>
  <script src="assets/js/admin-auth.js"></script>
  <script src="assets/js/schedule-import.js"></script>
  <script src="assets/js/league-store.js"></script>
  <script src="assets/js/tournament-standings.js"></script>
  <script>
    window.RHMAdminAuth.wireLogoutLinks();
    window.RHMAdminAuth.requireAdmin();

    var leagues = [];
    var currentLeague = null;

    function eh(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function toggleNewLeagueForm() {
      document.getElementById('new-league-panel').classList.toggle('active');
    }

    async function createLeague() {
      var name = document.getElementById('nl-name').value.trim();
      if (!name) { alert('League name is required.'); return; }
      var league = window.RHMLeagueStore.newLeague({
        name: name,
        season: document.getElementById('nl-season').value.trim(),
        startDate: document.getElementById('nl-start-date').value
      });
      try {
        await window.RHMLeagueStore.saveLeague(league);
      } catch (error) {
        alert('Could not create league: ' + (error.message || 'Unknown error'));
        return;
      }
      document.getElementById('nl-name').value = '';
      document.getElementById('nl-season').value = '';
      document.getElementById('nl-start-date').value = '';
      document.getElementById('new-league-panel').classList.remove('active');
      await loadAndRenderLeagues();
      openLeague(league.id);
    }

    function leagueCardHTML(league) {
      return '<div class="league-card" onclick="openLeague(\'' + eh(league.id) + '\')">' +
        '<div class="league-card-name">' + eh(league.name) + '</div>' +
        '<div class="league-card-meta">' + eh(league.season || league.sport) + (league.startDate ? ' · ' + eh(league.startDate) : '') + '</div>' +
        '<span class="status-badge status-' + eh(league.status) + '">' + eh(league.status) + '</span>' +
        '</div>';
    }

    function renderLeagueList() {
      var grid = document.getElementById('league-grid');
      var count = document.getElementById('league-count');
      count.textContent = leagues.length + (leagues.length === 1 ? ' league' : ' leagues');
      grid.innerHTML = leagues.length
        ? leagues.map(leagueCardHTML).join('')
        : '<div class="empty-note">No leagues yet. Create one to get started.</div>';
    }

    async function loadAndRenderLeagues() {
      try {
        leagues = await window.RHMLeagueStore.loadLeagues();
      } catch (error) {
        document.getElementById('league-count').textContent = 'Error loading leagues';
        document.getElementById('league-grid').innerHTML = '<div class="empty-note">Could not load leagues: ' + eh(error.message || 'Unknown error') + '</div>';
        return;
      }
      renderLeagueList();
    }

    function showListView() {
      currentLeague = null;
      document.getElementById('view-editor').classList.remove('active');
      document.getElementById('view-list').classList.remove('hidden');
    }

    function showEditorView() {
      document.getElementById('view-list').classList.add('hidden');
      document.getElementById('view-editor').classList.add('active');
    }

    async function openLeague(id) {
      try {
        currentLeague = await window.RHMLeagueStore.loadLeague(id);
      } catch (error) {
        alert('Could not load league: ' + (error.message || 'Unknown error'));
        return;
      }
      if (!currentLeague) { alert('League not found.'); return; }
      showEditorView();
      renderEditor();
      switchTab('details');
    }

    function renderEditor() {
      document.getElementById('ed-name').value = currentLeague.name;
      document.getElementById('ed-season').value = currentLeague.season;
      document.getElementById('ed-start-date').value = currentLeague.startDate;
      document.getElementById('ed-sport').value = currentLeague.sport;

      var badge = document.getElementById('editor-status-badge');
      badge.className = 'status-badge status-' + currentLeague.status;
      badge.textContent = currentLeague.status;

      var publishBtn = document.getElementById('publish-btn');
      publishBtn.textContent = currentLeague.status === 'published' ? 'Unpublish' : 'Publish';

      document.getElementById('delete-btn').style.display = currentLeague.status === 'draft' ? '' : 'none';

      renderTeams();
    }

    function updateLeagueField(key, value) {
      currentLeague[key] = value;
    }

    async function saveCurrentLeague() {
      try {
        currentLeague = await window.RHMLeagueStore.saveLeague(currentLeague);
      } catch (error) {
        alert('Could not save league: ' + (error.message || 'Unknown error'));
        return;
      }
      await loadAndRenderLeagues();
      alert('League saved.');
    }

    async function togglePublish() {
      try {
        if (currentLeague.status === 'published') {
          currentLeague = await window.RHMLeagueStore.unpublishLeague(currentLeague.id);
        } else {
          currentLeague = await window.RHMLeagueStore.publishLeague(currentLeague.id);
        }
      } catch (error) {
        alert('Could not update publish status: ' + (error.message || 'Unknown error'));
        return;
      }
      renderEditor();
    }

    async function archiveCurrentLeague() {
      if (!confirm('Archive this league? It will no longer be editable from the list as active.')) return;
      try {
        currentLeague = await window.RHMLeagueStore.archiveLeague(currentLeague.id);
      } catch (error) {
        alert('Could not archive league: ' + (error.message || 'Unknown error'));
        return;
      }
      renderEditor();
    }

    async function deleteCurrentLeague() {
      if (!confirm('Permanently delete this draft league? This cannot be undone.')) return;
      try {
        await window.RHMLeagueStore.deleteLeague(currentLeague.id);
      } catch (error) {
        alert('Could not delete league: ' + (error.message || 'Unknown error'));
        return;
      }
      showListView();
      await loadAndRenderLeagues();
    }

    function switchTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      });
      document.querySelectorAll('.tab-panel').forEach(function (panel) {
        panel.classList.toggle('active', panel.dataset.panel === tab);
      });
      if (tab === 'schedule' && window.renderScheduleTab) window.renderScheduleTab();
      if (tab === 'standings' && window.renderStandingsTab) window.renderStandingsTab();
      if (tab === 'playoffs' && window.renderPlayoffsTab) window.renderPlayoffsTab();
    }

    function teamUsage(teamId) {
      var games = currentLeague.state.games.filter(function (g) {
        return g.homeTeamId === teamId || g.awayTeamId === teamId;
      });
      var inPlayoffs = (currentLeague.state.playoffs.rounds || []).some(function (round) {
        return round.matchups.some(function (m) { return m.homeTeamId === teamId || m.awayTeamId === teamId; });
      });
      return { games: games.length, inPlayoffs: inPlayoffs };
    }

    function renderTeams() {
      var list = document.getElementById('teams-list');
      var teams = currentLeague.state.teams;
      if (!teams.length) {
        list.innerHTML = '<div class="empty-note">No teams yet. Add your first team below.</div>';
        return;
      }
      list.innerHTML = teams.map(function (t) {
        var usage = teamUsage(t.id);
        var warn = (usage.games || usage.inPlayoffs)
          ? '<span class="team-row-warning">Used in ' + usage.games + ' game(s)' + (usage.inPlayoffs ? ' + playoffs' : '') + ' — remove those first</span>'
          : '';
        return '<div class="team-row"><span class="team-row-name">' + eh(t.name) + '</span>' + warn +
          '<button class="btn-small" type="button" onclick="removeTeam(\'' + eh(t.id) + '\')">Remove</button></div>';
      }).join('');
    }

    function addTeam() {
      var input = document.getElementById('new-team-name');
      var name = input.value.trim();
      if (!name) return;
      currentLeague.state.teams.push({ id: 'team-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), name: name });
      input.value = '';
      renderTeams();
    }

    function removeTeam(id) {
      var usage = teamUsage(id);
      if (usage.games || usage.inPlayoffs) {
        alert('This team is used in games or playoffs. Remove those references first.');
        return;
      }
      currentLeague.state.teams = currentLeague.state.teams.filter(function (t) { return t.id !== id; });
      renderTeams();
    }

    (async function init() {
      await loadAndRenderLeagues();
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Manually verify in a browser**

Start a local server (e.g. `npx serve .` or any static server) and open `admin-league.html`. Confirm:
- Redirects to `admin-login.html` if not logged in as admin (via `requireAdmin()`)
- Once logged in: "+ New League" reveals the create form; creating a league named "RHM Fall 2026 Basketball League" with season "Fall 2026" and start date 2026-08-30 opens the editor
- Details tab: editing name/season/start date/sport and clicking Save persists (reload the page — the league still shows the edited values)
- Teams tab: adding "Team 1" through "Team 10" lists all ten; Remove works when a team has no games

- [ ] **Step 3: Commit**

```bash
git add admin-league.html
git commit -m "Add admin-league.html: list view, Details and Teams tabs"
```

---

## Task 7: `admin-league.html` — Schedule tab (manual entry + CSV import)

**Files:**
- Modify: `admin-league.html`

- [ ] **Step 1: Add Schedule-tab functions**

Insert the following functions into the `<script>` block, immediately before the `(async function init() {` line at the bottom:

```js
    function sortedGames() {
      return currentLeague.state.games.slice().sort(function (a, b) {
        return (a.date + ' ' + a.time).localeCompare(b.date + ' ' + b.time);
      });
    }

    function teamName(id) {
      var team = currentLeague.state.teams.filter(function (t) { return t.id === id; })[0];
      return team ? team.name : '—';
    }

    function teamOptionsHTML(selectedId) {
      return currentLeague.state.teams.map(function (t) {
        return '<option value="' + eh(t.id) + '"' + (t.id === selectedId ? ' selected' : '') + '>' + eh(t.name) + '</option>';
      }).join('');
    }

    function gameRowHTML(g) {
      var scoreCell = '<input type="number" value="' + (g.homeScore == null ? '' : g.homeScore) + '" onchange="updateGameScore(\'' + eh(g.id) + '\', \'homeScore\', this.value)"> – ' +
        '<input type="number" value="' + (g.awayScore == null ? '' : g.awayScore) + '" onchange="updateGameScore(\'' + eh(g.id) + '\', \'awayScore\', this.value)">';
      return '<tr>' +
        '<td>' + eh(g.date) + '</td>' +
        '<td>' + eh(g.time) + '</td>' +
        '<td>' + eh(g.location) + '</td>' +
        '<td>' + eh(teamName(g.homeTeamId)) + '</td>' +
        '<td>' + eh(teamName(g.awayTeamId)) + '</td>' +
        '<td>' + scoreCell + '</td>' +
        '<td><span class="status-pill ' + eh(g.status) + '">' + eh(g.status) + '</span></td>' +
        '<td><button class="btn-small" type="button" onclick="markGameFinal(\'' + eh(g.id) + '\')">Mark Final</button> ' +
        '<button class="btn-small" type="button" onclick="deleteGame(\'' + eh(g.id) + '\')">Delete</button></td>' +
        '</tr>';
    }

    function addGameFromForm() {
      var date = document.getElementById('ng-date').value;
      var time = document.getElementById('ng-time').value;
      var location = document.getElementById('ng-location').value.trim();
      var home = document.getElementById('ng-home').value;
      var away = document.getElementById('ng-away').value;
      if (!date) { alert('Date is required.'); return; }
      if (!home || !away || home === away) { alert('Pick two different teams.'); return; }
      currentLeague.state.games.push({
        id: 'game-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        date: date, time: time, location: location,
        homeTeamId: home, awayTeamId: away,
        homeScore: null, awayScore: null, status: 'scheduled'
      });
      document.getElementById('ng-location').value = '';
      renderScheduleTab();
    }

    function updateGameScore(id, field, value) {
      var game = currentLeague.state.games.filter(function (g) { return g.id === id; })[0];
      if (!game) return;
      game[field] = value === '' ? null : Number(value);
    }

    function markGameFinal(id) {
      var game = currentLeague.state.games.filter(function (g) { return g.id === id; })[0];
      if (!game) return;
      if (game.homeScore == null || game.awayScore == null) {
        alert('Enter both scores before marking this game final.');
        return;
      }
      game.status = 'final';
      renderScheduleTab();
    }

    function deleteGame(id) {
      if (!confirm('Delete this game?')) return;
      currentLeague.state.games = currentLeague.state.games.filter(function (g) { return g.id !== id; });
      renderScheduleTab();
    }

    var pendingCsvImport = null;

    function downloadScheduleTemplate() {
      var csv = 'Date,Time,Location,Home Team,Away Team,Home Score,Away Score\n' +
        '2026-08-30,14:00,Court 1,Team A,Team B,,\n' +
        '2026-09-06,15:30,Court 2,Team C,Team D,,\n';
      var blob = new Blob([csv], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'league-schedule-template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function handleScheduleCsvSelect(event) {
      var file = event.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        pendingCsvImport = window.RHMLeagueStore.parseLeagueScheduleCSV(String(reader.result), currentLeague.state.teams);
        renderCsvImportPreview();
      };
      reader.readAsText(file);
    }

    function renderCsvImportPreview() {
      var el = document.getElementById('csv-import-preview');
      if (!el) return;
      if (!pendingCsvImport) { el.innerHTML = ''; return; }
      var r = pendingCsvImport;
      var errorsHTML = r.errors.length
        ? '<div class="csv-import-errors"><div class="cie-title">' + r.errors.length + ' Problem' + (r.errors.length === 1 ? '' : 's') + '</div><ul>' +
          r.errors.map(function (e) { return '<li>Row ' + e.rowNumber + ': ' + eh(e.message) + '</li>'; }).join('') + '</ul></div>'
        : '';
      var newTeamsNote = r.newTeamNames.length
        ? '<div class="csv-import-hint">' + r.newTeamNames.length + ' new team(s) will be created: ' + eh(r.newTeamNames.join(', ')) + '</div>'
        : '';
      el.innerHTML =
        '<div class="csv-import-hint">' + r.games.length + ' game(s) ready to import.</div>' +
        newTeamsNote + errorsHTML +
        (r.games.length ? '<button class="btn-primary" type="button" style="margin-top:0.75rem;" onclick="confirmScheduleCsvImport()">Confirm Import</button>' : '');
    }

    function confirmScheduleCsvImport() {
      if (!pendingCsvImport) return;
      var byLowerName = {};
      currentLeague.state.teams.forEach(function (t) { byLowerName[t.name.toLowerCase()] = t.id; });
      pendingCsvImport.newTeamNames.forEach(function (name) {
        var id = 'team-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        currentLeague.state.teams.push({ id: id, name: name });
        byLowerName[name.toLowerCase()] = id;
      });
      pendingCsvImport.games.forEach(function (g) {
        currentLeague.state.games.push({
          id: 'game-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          date: g.date, time: g.time, location: g.location,
          homeTeamId: byLowerName[g.homeTeamName.toLowerCase()],
          awayTeamId: byLowerName[g.awayTeamName.toLowerCase()],
          homeScore: g.homeScore, awayScore: g.awayScore, status: g.status
        });
      });
      pendingCsvImport = null;
      var fileInput = document.getElementById('csv-file-input');
      if (fileInput) fileInput.value = '';
      renderScheduleTab();
    }

    function renderScheduleTab() {
      var body = document.getElementById('schedule-tab-body');
      var games = sortedGames();
      var rowsHTML = games.length
        ? games.map(gameRowHTML).join('')
        : '<tr><td colspan="8" class="empty-note">No games yet.</td></tr>';

      var addFormHTML = currentLeague.state.teams.length < 2
        ? '<div class="empty-note">Add at least two teams before scheduling games.</div>'
        : '<div class="row-3">' +
            '<div class="field"><label for="ng-date">Date</label><input type="date" id="ng-date"></div>' +
            '<div class="field"><label for="ng-time">Time</label><input type="time" id="ng-time"></div>' +
            '<div class="field"><label for="ng-location">Location</label><input type="text" id="ng-location" placeholder="Court 1"></div>' +
          '</div>' +
          '<div class="row-2">' +
            '<div class="field"><label for="ng-home">Home Team</label><select id="ng-home">' + teamOptionsHTML() + '</select></div>' +
            '<div class="field"><label for="ng-away">Away Team</label><select id="ng-away">' + teamOptionsHTML() + '</select></div>' +
          '</div>' +
          '<button class="btn-primary" type="button" onclick="addGameFromForm()">+ Add Game</button>';

      body.innerHTML = addFormHTML +
        '<div class="csv-import-row">' +
          '<label class="csv-file-label" for="csv-file-input">Choose CSV File</label>' +
          '<input type="file" id="csv-file-input" accept=".csv" style="display:none;" onchange="handleScheduleCsvSelect(event)">' +
          '<button class="btn-small" type="button" onclick="downloadScheduleTemplate()">Download Template</button>' +
          '<span class="csv-import-hint">Columns: Date, Time, Location, Home Team, Away Team, Home Score, Away Score (scores optional)</span>' +
          '<div id="csv-import-preview" style="flex-basis:100%;"></div>' +
        '</div>' +
        '<table class="sched-tbl"><thead><tr>' +
          '<th>Date</th><th>Time</th><th>Location</th><th>Home</th><th>Away</th><th>Score</th><th>Status</th><th></th>' +
        '</tr></thead><tbody>' + rowsHTML + '</tbody></table>';
    }
    window.renderScheduleTab = renderScheduleTab;
```

- [ ] **Step 2: Manually verify in a browser**

Open `admin-league.html`, open the test league from Task 6, go to the Schedule tab. Confirm:
- Adding a game via the form (date 2026-08-30, home Team 1, away Team 2) adds a row with status "scheduled"
- Entering both scores and clicking "Mark Final" changes the status pill to "final"
- Clicking "Download Template" downloads a CSV file
- Re-uploading that same template file via "Choose CSV File" shows a preview with 2 games and no errors; clicking "Confirm Import" adds `Team A`/`Team B`/`Team C`/`Team D` as new teams (visible on the Teams tab afterward) and adds both games to the table

- [ ] **Step 3: Commit**

```bash
git add admin-league.html
git commit -m "Add Schedule tab to admin-league.html: manual entry + CSV import"
```

---

## Task 8: `admin-league.html` — Standings tab

**Files:**
- Modify: `admin-league.html`

- [ ] **Step 1: Add the Standings-tab render function**

Insert immediately before the `(async function init() {` line at the bottom of the `<script>` block:

```js
    function renderStandingsTab() {
      var body = document.getElementById('standings-tab-body');
      if (currentLeague.state.teams.length === 0) {
        body.innerHTML = '<div class="empty-note">Add teams to see standings.</div>';
        return;
      }
      var config = window.RHMLeagueStore.leagueToStandingsConfig(currentLeague);
      var result = window.RHMTournamentStandings.computeStandings(config)[0];
      var rows = result ? result.rows : [];

      body.innerHTML = '<table class="stg-tbl"><thead><tr>' +
        '<th>Rank</th><th>Team</th><th>W</th><th>L</th><th>PF</th><th>PA</th><th>Diff</th>' +
        '</tr></thead><tbody>' +
        rows.map(function (row) {
          var diffClass = row.diff > 0 ? 'diff-p' : (row.diff < 0 ? 'diff-n' : '');
          return '<tr>' +
            '<td class="stg-rank">' + row.rank + '</td>' +
            '<td>' + eh(row.team) + '</td>' +
            '<td>' + row.wins + '</td>' +
            '<td>' + row.losses + '</td>' +
            '<td>' + row.pf + '</td>' +
            '<td>' + row.pa + '</td>' +
            '<td class="' + diffClass + '">' + (row.diff > 0 ? '+' : '') + row.diff + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table>';
    }
    window.renderStandingsTab = renderStandingsTab;
```

- [ ] **Step 2: Manually verify in a browser**

On the Schedule tab, mark at least one game final with a clear winner (e.g. home 50, away 40). Switch to the Standings tab and confirm the winning team shows 1 win, the losing team 1 loss, and both show the correct PF/PA/Diff, ranked with the winner first.

- [ ] **Step 3: Commit**

```bash
git add admin-league.html
git commit -m "Add Standings tab to admin-league.html (computed via tournament-standings.js)"
```

---

## Task 9: `admin-league.html` — Playoffs tab

**Files:**
- Modify: `admin-league.html`

- [ ] **Step 1: Add Playoffs-tab functions**

Insert immediately before the `(async function init() {` line at the bottom of the `<script>` block:

```js
    function allPriorWinners() {
      var options = [];
      (currentLeague.state.playoffs.rounds || []).forEach(function (round) {
        round.matchups.forEach(function (m) {
          if (m.winnerTeamId) {
            options.push({ value: 'winner:' + m.id, label: 'Winner of ' + round.name + ' — ' + m.label });
          }
        });
      });
      return options;
    }

    function resolveMatchupTeamId(ref) {
      if (!ref) return null;
      if (ref.indexOf('winner:') === 0) {
        var matchupId = ref.slice('winner:'.length);
        var found = null;
        (currentLeague.state.playoffs.rounds || []).forEach(function (round) {
          round.matchups.forEach(function (m) { if (m.id === matchupId) found = m; });
        });
        return found ? found.winnerTeamId : null;
      }
      return ref;
    }

    function matchupTeamLabel(ref) {
      var resolved = resolveMatchupTeamId(ref);
      return resolved ? teamName(resolved) : (ref ? 'TBD' : '—');
    }

    function matchupTeamOptionsHTML(selectedRef) {
      var options = ['<option value="">— Select —</option>'];
      currentLeague.state.teams.forEach(function (t) {
        options.push('<option value="' + eh(t.id) + '"' + (t.id === selectedRef ? ' selected' : '') + '>' + eh(t.name) + '</option>');
      });
      allPriorWinners().forEach(function (opt) {
        options.push('<option value="' + eh(opt.value) + '"' + (opt.value === selectedRef ? ' selected' : '') + '>' + eh(opt.label) + '</option>');
      });
      return options.join('');
    }

    function togglePlayoffsEnabled() {
      currentLeague.state.playoffs.enabled = !currentLeague.state.playoffs.enabled;
      renderPlayoffsTab();
    }

    function findRound(roundId) {
      return currentLeague.state.playoffs.rounds.filter(function (r) { return r.id === roundId; })[0];
    }

    function addRound() {
      var input = document.getElementById('new-round-name');
      var name = input.value.trim();
      if (!name) { alert('Round name is required.'); return; }
      currentLeague.state.playoffs.rounds.push({
        id: 'round-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        name: name,
        matchups: []
      });
      input.value = '';
      renderPlayoffsTab();
    }

    function deleteRound(roundId) {
      if (!confirm('Delete this round and all its matchups?')) return;
      currentLeague.state.playoffs.rounds = currentLeague.state.playoffs.rounds.filter(function (r) { return r.id !== roundId; });
      renderPlayoffsTab();
    }

    function addMatchup(roundId) {
      var round = findRound(roundId);
      if (!round) return;
      round.matchups.push({
        id: 'matchup-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        label: 'Matchup ' + (round.matchups.length + 1),
        homeTeamId: null, awayTeamId: null,
        homeScore: null, awayScore: null,
        winnerTeamId: null, status: 'scheduled'
      });
      renderPlayoffsTab();
    }

    function updateMatchupTeam(roundId, matchupId, side, value) {
      var round = findRound(roundId);
      var matchup = round.matchups.filter(function (m) { return m.id === matchupId; })[0];
      if (!matchup) return;
      matchup[side] = value || null;
    }

    function updateMatchupScore(roundId, matchupId, side, value) {
      var round = findRound(roundId);
      var matchup = round.matchups.filter(function (m) { return m.id === matchupId; })[0];
      if (!matchup) return;
      matchup[side] = value === '' ? null : Number(value);
    }

    function declareWinner(roundId, matchupId) {
      var round = findRound(roundId);
      var matchup = round.matchups.filter(function (m) { return m.id === matchupId; })[0];
      if (!matchup) return;
      var homeId = resolveMatchupTeamId(matchup.homeTeamId);
      var awayId = resolveMatchupTeamId(matchup.awayTeamId);
      if (!homeId || !awayId) { alert('Both teams must be set before declaring a winner.'); return; }
      if (matchup.homeScore == null || matchup.awayScore == null) { alert('Enter both scores before declaring a winner.'); return; }
      if (matchup.homeScore === matchup.awayScore) { alert('Scores are tied — playoff games need a winner.'); return; }
      matchup.winnerTeamId = matchup.homeScore > matchup.awayScore ? homeId : awayId;
      matchup.status = 'final';
      renderPlayoffsTab();
    }

    function deleteMatchup(roundId, matchupId) {
      var round = findRound(roundId);
      round.matchups = round.matchups.filter(function (m) { return m.id !== matchupId; });
      renderPlayoffsTab();
    }

    function matchupCardHTML(round, m) {
      var winnerHTML = m.winnerTeamId
        ? '<span class="matchup-winner">Winner: ' + eh(teamName(m.winnerTeamId)) + '</span>'
        : '<button class="btn-small" type="button" onclick="declareWinner(\'' + eh(round.id) + '\', \'' + eh(m.id) + '\')">Declare Winner</button>';
      return '<div class="matchup-card">' +
        '<div class="matchup-teams">' +
          '<select onchange="updateMatchupTeam(\'' + eh(round.id) + '\', \'' + eh(m.id) + '\', \'homeTeamId\', this.value)">' + matchupTeamOptionsHTML(m.homeTeamId) + '</select>' +
          '<input type="number" value="' + (m.homeScore == null ? '' : m.homeScore) + '" onchange="updateMatchupScore(\'' + eh(round.id) + '\', \'' + eh(m.id) + '\', \'homeScore\', this.value)">' +
          '<span>vs</span>' +
          '<input type="number" value="' + (m.awayScore == null ? '' : m.awayScore) + '" onchange="updateMatchupScore(\'' + eh(round.id) + '\', \'' + eh(m.id) + '\', \'awayScore\', this.value)">' +
          '<select onchange="updateMatchupTeam(\'' + eh(round.id) + '\', \'' + eh(m.id) + '\', \'awayTeamId\', this.value)">' + matchupTeamOptionsHTML(m.awayTeamId) + '</select>' +
        '</div>' +
        winnerHTML +
        '<button class="btn-small" type="button" onclick="deleteMatchup(\'' + eh(round.id) + '\', \'' + eh(m.id) + '\')">Delete</button>' +
        '</div>';
    }

    function roundBlockHTML(round) {
      return '<div class="round-block">' +
        '<div class="round-title">' + eh(round.name) + ' <button class="btn-small" type="button" onclick="deleteRound(\'' + eh(round.id) + '\')">Delete Round</button></div>' +
        round.matchups.map(function (m) { return matchupCardHTML(round, m); }).join('') +
        '<button class="btn-outline" type="button" onclick="addMatchup(\'' + eh(round.id) + '\')">+ Add Matchup</button>' +
        '</div>';
    }

    function renderPlayoffsTab() {
      var body = document.getElementById('playoffs-tab-body');
      var playoffs = currentLeague.state.playoffs;
      var toggleLabel = playoffs.enabled ? 'Disable Playoffs' : 'Enable Playoffs';
      var html = '<button class="btn-outline" type="button" onclick="togglePlayoffsEnabled()">' + toggleLabel + '</button>';
      if (!playoffs.enabled) {
        html += '<div class="empty-note">Playoffs are disabled. They will not appear on the public league page.</div>';
        body.innerHTML = html;
        return;
      }
      html += '<div class="add-team-row" style="margin:1rem 0;">' +
        '<input type="text" id="new-round-name" placeholder="Round name, e.g. Semifinals">' +
        '<button class="btn-primary" type="button" onclick="addRound()">+ Add Round</button>' +
        '</div>';
      html += playoffs.rounds.length
        ? playoffs.rounds.map(roundBlockHTML).join('')
        : '<div class="empty-note">No rounds yet.</div>';
      body.innerHTML = html;
    }
    window.renderPlayoffsTab = renderPlayoffsTab;
```

- [ ] **Step 2: Manually verify in a browser**

On the Playoffs tab: click "Enable Playoffs", add a round named "Semifinals", add two matchups, assign teams from the dropdowns, enter scores, and click "Declare Winner" on each — confirm the winner label appears and the button disappears. Add a second round named "Final", confirm its team dropdowns now include "Winner of Semifinals — Matchup 1" and "Winner of Semifinals — Matchup 2" as selectable options.

- [ ] **Step 3: Commit**

```bash
git add admin-league.html
git commit -m "Add Playoffs tab to admin-league.html: manual rounds and matchups"
```

---

## Task 10: `league.html` — public league page

**Files:**
- Create: `league.html`

- [ ] **Step 1: Create `league.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>League — RHM</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&display=swap" rel="stylesheet">
  <style>
    :root {
      --green: #2db84b;
      --black: #0a0a0a;
      --white: #f2f2ee;
      --muted: #888;
      --surface: #111;
      --surface2: #161616;
      --border: #1e1e1e;
      --border2: #2a2a2a;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body { background: var(--black); color: var(--white); font-family: 'DM Sans', sans-serif; min-height: 100vh; }

    .site-header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 2.5rem; height: 64px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
    .header-left { display: flex; align-items: center; gap: 1rem; }
    .header-left a { display: flex; align-items: center; }
    .header-left img { height: 36px; }

    .main { max-width: 1300px; margin: 0 auto; padding: 2.5rem 2rem 4rem; }

    .l-hero { margin-bottom: 2.5rem; display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 1rem; }
    .l-sport-tag { font-size: 11px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--green); margin-bottom: 0.5rem; }
    .l-name { font-family: 'Bebas Neue', sans-serif; font-size: 3.25rem; letter-spacing: 0.06em; color: var(--white); line-height: 1; margin-bottom: 0.5rem; }
    .l-meta { font-size: 13px; color: var(--muted); }
    .season-select { background: var(--surface); border: 1px solid var(--border2); color: var(--white); font-size: 13px; padding: 0.5rem 0.75rem; }

    .tab-nav { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 2rem; overflow-x: auto; }
    .tab-btn { background: none; border: none; border-bottom: 2px solid transparent; color: var(--muted); font-family: 'Bebas Neue', sans-serif; font-size: 1.05rem; letter-spacing: 0.08em; padding: 0.85rem 1.4rem; cursor: pointer; }
    .tab-btn:hover { color: var(--white); }
    .tab-btn.active { color: var(--green); border-bottom-color: var(--green); }
    .l-panel { display: none; }
    .l-panel.active { display: block; }

    .stg-tbl { width: 100%; border-collapse: collapse; font-size: 13px; max-width: 640px; }
    .stg-tbl th { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); padding: 0.5rem; text-align: left; border-bottom: 1px solid var(--border); }
    .stg-tbl td { padding: 0.55rem 0.5rem; border-bottom: 1px solid var(--border); }
    .stg-tbl tr:nth-child(even) td { background: var(--surface2); }
    .stg-rank { font-weight: 700; color: #555; }
    .diff-p { color: var(--green); }
    .diff-n { color: #e05555; }

    .sched-date-group { margin-bottom: 1.75rem; }
    .sched-date-label { font-family: 'Bebas Neue', sans-serif; font-size: 1.1rem; letter-spacing: 0.08em; color: var(--green); margin-bottom: 0.6rem; }
    .sched-wrap { overflow-x: auto; }
    .sched-table { border-collapse: collapse; min-width: 500px; width: 100%; }
    .sched-table th { background: var(--green); color: #fff; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 0.55rem 0.75rem; text-align: left; white-space: nowrap; border: 1px solid rgba(255,255,255,0.1); }
    .sched-table td { padding: 0.55rem 0.75rem; border: 1px solid var(--border); font-size: 13px; }

    .team-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1rem; }
    .team-card { background: var(--surface); border: 1px solid var(--border); padding: 1.25rem; text-align: center; font-family: 'Bebas Neue', sans-serif; font-size: 1.15rem; letter-spacing: 0.05em; }

    .round-block { margin-bottom: 2rem; }
    .round-title { font-family: 'Bebas Neue', sans-serif; font-size: 1.3rem; letter-spacing: 0.06em; color: var(--green); margin-bottom: 0.75rem; }
    .matchup-card { background: var(--surface); border: 1px solid var(--border); padding: 1rem; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.75rem; max-width: 480px; }
    .matchup-side { flex: 1; font-size: 14px; }
    .matchup-side.winner { color: var(--green); font-weight: 700; }
    .matchup-score { font-family: 'Bebas Neue', sans-serif; font-size: 1.2rem; }

    .notice { color: var(--muted); font-size: 14px; padding: 2rem 0; }

    @media (max-width: 600px) {
      .l-name { font-size: 2.25rem; }
    }
  </style>
</head>
<body>
  <nav class="site-header">
    <div class="header-left">
      <a href="index.html" aria-label="RHM home"><img src="RHM-Logo.png" alt="RHM Logo"></a>
    </div>
    <div id="season-switcher-wrap"></div>
  </nav>

  <main class="main" id="league-main">
    <div class="notice" id="loading-notice">Loading league…</div>
  </main>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="assets/js/supabase-config.js"></script>
  <script src="assets/js/league-store.js"></script>
  <script src="assets/js/tournament-standings.js"></script>
  <script>
    var allPublishedLeagues = [];
    var league = null;

    function eh(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function teamName(id) {
      var team = league.state.teams.filter(function (t) { return t.id === id; })[0];
      return team ? team.name : 'TBD';
    }

    function resolveMatchupTeamId(ref) {
      if (!ref) return null;
      if (String(ref).indexOf('winner:') === 0) {
        var matchupId = ref.slice('winner:'.length);
        var found = null;
        (league.state.playoffs.rounds || []).forEach(function (round) {
          round.matchups.forEach(function (m) { if (m.id === matchupId) found = m; });
        });
        return found ? found.winnerTeamId : null;
      }
      return ref;
    }

    function formatDateLabel(dateStr) {
      if (!dateStr) return '';
      return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }

    function formatTime12(value) {
      if (!value) return '';
      return new Date('1970-01-01T' + value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    function renderStandings() {
      var el = document.getElementById('panel-standings');
      if (!league.state.teams.length) {
        el.innerHTML = '<div class="notice">Standings will appear once teams are added.</div>';
        return;
      }
      var config = window.RHMLeagueStore.leagueToStandingsConfig(league);
      var result = window.RHMTournamentStandings.computeStandings(config)[0];
      var rows = result ? result.rows : [];
      el.innerHTML = '<table class="stg-tbl"><thead><tr>' +
        '<th>Rank</th><th>Team</th><th>W</th><th>L</th><th>PF</th><th>PA</th><th>Diff</th>' +
        '</tr></thead><tbody>' +
        rows.map(function (row) {
          var diffClass = row.diff > 0 ? 'diff-p' : (row.diff < 0 ? 'diff-n' : '');
          return '<tr><td class="stg-rank">' + row.rank + '</td><td>' + eh(row.team) + '</td><td>' + row.wins + '</td><td>' + row.losses + '</td><td>' + row.pf + '</td><td>' + row.pa + '</td><td class="' + diffClass + '">' + (row.diff > 0 ? '+' : '') + row.diff + '</td></tr>';
        }).join('') +
        '</tbody></table>';
    }

    function renderSchedule() {
      var el = document.getElementById('panel-schedule');
      var games = league.state.games.slice().sort(function (a, b) {
        return (a.date + ' ' + a.time).localeCompare(b.date + ' ' + b.time);
      });
      if (!games.length) {
        el.innerHTML = '<div class="notice">No games scheduled yet.</div>';
        return;
      }
      var byDate = {};
      var dateOrder = [];
      games.forEach(function (g) {
        if (!byDate[g.date]) { byDate[g.date] = []; dateOrder.push(g.date); }
        byDate[g.date].push(g);
      });
      el.innerHTML = dateOrder.map(function (date) {
        var rows = byDate[date].map(function (g) {
          var score = g.status === 'final' ? (g.homeScore + ' – ' + g.awayScore) : '—';
          return '<tr><td>' + eh(formatTime12(g.time)) + '</td><td>' + eh(teamName(g.homeTeamId)) + ' vs ' + eh(teamName(g.awayTeamId)) + '</td><td>' + eh(g.location) + '</td><td>' + score + '</td></tr>';
        }).join('');
        return '<div class="sched-date-group"><div class="sched-date-label">' + eh(formatDateLabel(date)) + '</div>' +
          '<div class="sched-wrap"><table class="sched-table"><thead><tr><th>Time</th><th>Matchup</th><th>Location</th><th>Score</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
      }).join('');
    }

    function renderTeams() {
      var el = document.getElementById('panel-teams');
      if (!league.state.teams.length) {
        el.innerHTML = '<div class="notice">Teams will be listed here once added.</div>';
        return;
      }
      el.innerHTML = '<div class="team-grid">' +
        league.state.teams.map(function (t) { return '<div class="team-card">' + eh(t.name) + '</div>'; }).join('') +
        '</div>';
    }

    function matchupSideHTML(ref, m) {
      var resolved = resolveMatchupTeamId(ref);
      var isWinner = resolved && m.winnerTeamId === resolved;
      var label = resolved ? teamName(resolved) : 'TBD';
      return '<span class="matchup-side' + (isWinner ? ' winner' : '') + '">' + eh(label) + '</span>';
    }

    function renderPlayoffs() {
      var el = document.getElementById('panel-playoffs');
      if (!el) return;
      var playoffs = league.state.playoffs;
      if (!playoffs.enabled || !playoffs.rounds.length) {
        el.innerHTML = '<div class="notice">Playoffs have not started yet.</div>';
        return;
      }
      el.innerHTML = playoffs.rounds.map(function (round) {
        var cards = round.matchups.map(function (m) {
          var score = m.status === 'final' ? '<span class="matchup-score">' + m.homeScore + ' – ' + m.awayScore + '</span>' : '<span class="matchup-score">vs</span>';
          return '<div class="matchup-card">' + matchupSideHTML(m.homeTeamId, m) + score + matchupSideHTML(m.awayTeamId, m) + '</div>';
        }).join('');
        return '<div class="round-block"><div class="round-title">' + eh(round.name) + '</div>' + cards + '</div>';
      }).join('');
    }

    function switchTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(function (btn) { btn.classList.toggle('active', btn.dataset.tab === tab); });
      document.querySelectorAll('.l-panel').forEach(function (panel) { panel.classList.toggle('active', panel.id === 'panel-' + tab); });
    }

    function renderLeaguePage() {
      var main = document.getElementById('league-main');
      var showPlayoffsTab = league.state.playoffs.enabled;
      main.innerHTML =
        '<div class="l-hero">' +
          '<div><div class="l-sport-tag">' + eh(league.sport) + (league.season ? ' · ' + eh(league.season) : '') + '</div>' +
          '<div class="l-name">' + eh(league.name) + '</div>' +
          '<div class="l-meta">' + (league.startDate ? 'Starts ' + eh(formatDateLabel(league.startDate)) : '') + '</div></div>' +
        '</div>' +
        '<div class="tab-nav">' +
          '<button class="tab-btn active" data-tab="standings" onclick="switchTab(\'standings\')">Standings</button>' +
          '<button class="tab-btn" data-tab="schedule" onclick="switchTab(\'schedule\')">Schedule</button>' +
          '<button class="tab-btn" data-tab="teams" onclick="switchTab(\'teams\')">Teams</button>' +
          (showPlayoffsTab ? '<button class="tab-btn" data-tab="playoffs" onclick="switchTab(\'playoffs\')">Playoffs</button>' : '') +
        '</div>' +
        '<div class="l-panel active" id="panel-standings"></div>' +
        '<div class="l-panel" id="panel-schedule"></div>' +
        '<div class="l-panel" id="panel-teams"></div>' +
        (showPlayoffsTab ? '<div class="l-panel" id="panel-playoffs"></div>' : '');

      renderStandings();
      renderSchedule();
      renderTeams();
      if (showPlayoffsTab) renderPlayoffs();
    }

    function renderSeasonSwitcher() {
      var wrap = document.getElementById('season-switcher-wrap');
      if (allPublishedLeagues.length < 2) { wrap.innerHTML = ''; return; }
      wrap.innerHTML = '<select class="season-select" id="season-switcher" onchange="onSeasonChange(this.value)">' +
        allPublishedLeagues.map(function (l) {
          return '<option value="' + eh(l.id) + '"' + (l.id === league.id ? ' selected' : '') + '>' + eh(l.name) + '</option>';
        }).join('') + '</select>';
    }

    function onSeasonChange(id) {
      league = allPublishedLeagues.filter(function (l) { return l.id === id; })[0];
      renderLeaguePage();
    }

    (async function init() {
      try {
        allPublishedLeagues = await window.RHMLeagueStore.loadPublishedLeagues();
      } catch (error) {
        document.getElementById('league-main').innerHTML = '<div class="notice">Could not load the league right now. Please try again later.</div>';
        return;
      }
      if (!allPublishedLeagues.length) {
        document.getElementById('league-main').innerHTML = '<div class="notice">No league is currently active — check back soon.</div>';
        return;
      }
      league = allPublishedLeagues[0];
      renderSeasonSwitcher();
      renderLeaguePage();
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Manually verify in a browser**

With the league from Task 6-9 published (in `admin-league.html`, Details tab → Publish), open `league.html` directly:
- Hero shows the league name, season, and start date
- Standings tab shows the same ranked table as the admin Standings tab
- Schedule tab groups games under date headers, sorted chronologically, showing scores for final games and "—" for scheduled ones
- Teams tab lists all 10 teams
- If playoffs were enabled with a declared winner, the Playoffs tab appears and highlights the winner in green
- Unpublish the league in admin, reload `league.html`, confirm it now shows "No league is currently active"

- [ ] **Step 3: Commit**

```bash
git add league.html
git commit -m "Add league.html public page: standings, schedule, teams, playoffs"
```

---

## Task 11: `index.html` — add "League" nav link

**Files:**
- Modify: `index.html:518-523` (ghost top nav)
- Modify: `index.html:727-730` (bottom nav)
- Modify: `index.html:686-691` (footer)

- [ ] **Step 1: Add the link to the ghost top nav**

In `index.html`, change:

```html
    <ul class="tng-links">
      <li><a href="events.html">Events</a></li>
      <li><a href="photos.html">Photos</a></li>
      <li><a href="sponsors.html">Sponsors</a></li>
      <li><a href="about.html">About</a></li>
    </ul>
```

to:

```html
    <ul class="tng-links">
      <li><a href="events.html">Events</a></li>
      <li><a href="league.html">League</a></li>
      <li><a href="photos.html">Photos</a></li>
      <li><a href="sponsors.html">Sponsors</a></li>
      <li><a href="about.html">About</a></li>
    </ul>
```

- [ ] **Step 2: Add the link to the floating bottom nav**

Change:

```html
    <a href="#mission" class="bn-link" data-section="mission">About</a>
    <a href="#sports" class="bn-link" data-section="sports">Sports</a>
    <a href="#community" class="bn-link" data-section="community">Community</a>
    <a href="photos.html" class="bn-link">Photos</a>
```

to:

```html
    <a href="#mission" class="bn-link" data-section="mission">About</a>
    <a href="#sports" class="bn-link" data-section="sports">Sports</a>
    <a href="#community" class="bn-link" data-section="community">Community</a>
    <a href="league.html" class="bn-link">League</a>
    <a href="photos.html" class="bn-link">Photos</a>
```

- [ ] **Step 3: Add the link to the footer "Navigate" list**

Change:

```html
        <ul>
          <li><a href="about.html">About RHM</a></li>
          <li><a href="#sports">Sports Programs</a></li>
          <li><a href="#community">Community</a></li>
          <li><a href="events.html">Events</a></li>
          <li><a href="photos.html">Photos</a></li>
          <li><a href="sponsors.html">Sponsorship</a></li>
          <li><a href="admin-login.html">Admin Login</a></li>
        </ul>
```

to:

```html
        <ul>
          <li><a href="about.html">About RHM</a></li>
          <li><a href="#sports">Sports Programs</a></li>
          <li><a href="#community">Community</a></li>
          <li><a href="events.html">Events</a></li>
          <li><a href="league.html">League</a></li>
          <li><a href="photos.html">Photos</a></li>
          <li><a href="sponsors.html">Sponsorship</a></li>
          <li><a href="admin-login.html">Admin Login</a></li>
        </ul>
```

- [ ] **Step 4: Manually verify in a browser**

Open `index.html`, confirm "League" appears in the ghost top nav (visible on scroll), the floating bottom nav, and the footer — all three linking to `league.html`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add League link to site navigation"
```

---

## Task 12: Full regression pass and end-to-end manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `node --test tests/*.test.js`
Expected: PASS — every existing suite plus `league-store.test.js` green, zero failures

- [ ] **Step 2: Manual end-to-end smoke test**

Using a local static server and a real (or local) Supabase project with the `leagues` table migrated:

1. Log into `admin-login.html`, land on `admin-dashboard.html`, click "Go to League"
2. Create "RHM Fall 2026 Basketball League", season "Fall 2026", start date 2026-08-30
3. Add 10 teams on the Teams tab
4. On the Schedule tab, add at least 3 games across at least 2 different dates, enter scores for 2 of them and mark them final
5. Confirm the Standings tab reflects correct W/L/PF/PA/Diff and ranks the higher-scoring team first
6. Enable Playoffs, add a "Semifinals" round with 2 matchups using teams from the roster, declare a winner in each, then add a "Final" round and confirm the winners are selectable as "Winner of Semifinals — Matchup 1/2"
7. Declare the Final's winner
8. Click Publish on the Details tab
9. Open `league.html` in a new tab (not logged in as admin) — confirm Standings, Schedule (grouped by date), Teams, and Playoffs (with the champion highlighted) all render correctly
10. Go back to admin, Unpublish the league, reload `league.html`, confirm it shows "No league is currently active"
11. Re-publish, confirm `index.html` nav links (top ghost nav, bottom nav, footer) all navigate to `league.html` correctly

- [ ] **Step 3: Fix any issues found during the smoke test, re-run Step 1, then commit**

```bash
git add -A
git commit -m "Fix issues found in league feature smoke test"
```

(Skip this commit entirely if no issues were found.)

---

## Summary of Files

**New:**
- `assets/js/league-store.js`
- `tests/league-store.test.js`
- `admin-league.html`
- `league.html`

**Modified:**
- `supabase/schema.sql`
- `admin-dashboard.html`
- `index.html`

