# Tournament Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing RHM bracket creator into a reliable group-stage, schedule, standings, playoff, publish, and live-score tournament manager.

**Architecture:** Keep the static HTML/Supabase architecture and current visual design. Move tournament behavior into focused browser-global JavaScript modules that can be loaded in `node:test`, then make `admin-bracket.html` and `tournament-live.html` render/edit that shared state. Treat playoff games as real fixtures in the same schedule model as group games.

**Tech Stack:** Static HTML/CSS/JavaScript, browser-global IIFE modules, Supabase JS client, `node:test`, localStorage fallback.

---

## File Structure

- Create: `assets/js/tournament-groups.js`
  - Team list parsing, seeded snake grouping, random grouping, manual group normalization, sport-aware venue names.
- Replace/expand: `assets/js/tournament-engine.js`
  - Fixture generation, scheduling, validation, drag/drop move planning, playoff fixture generation, playoff progression.
- Create: `assets/js/tournament-standings.js`
  - Configurable standings rules, tiebreakers, head-to-head, seed overrides.
- Modify: `assets/js/tournament-store.js`
  - Draft/published/archived helpers while preserving localStorage fallback and current Supabase JSON storage.
- Modify: `admin-bracket.html`
  - Preserve visual style. Add setup modes, division-aware state, venue controls, blocks, publish controls, editable schedule, drag/drop hooks, score save flow.
- Modify: `tournament-live.html`
  - Preserve visual style. Add public tabs for Schedule, Standings, and Bracket. Show only published tournament state.
- Modify: `tests/tournament-engine.test.js`
  - Expand scheduler, validation, playoff, and drag/drop tests.
- Create: `tests/tournament-groups.test.js`
  - Group setup tests.
- Create: `tests/tournament-standings.test.js`
  - Standings and tiebreaker tests.
- Modify: `tests/helpers.test.js`
  - Store draft/publish tests.

## Execution Notes

- The repository does not have a `package.json`; use Node's built-in test runner directly.
- Run all tests with:

```bash
node --test tests/*.test.js
```

- The current worktree has unrelated changes in `.env.example` and untracked `AGENTS.md`. Do not stage or modify those unless explicitly instructed.
- Commit after each task. Only stage files listed in that task.

---

### Task 1: Group Setup Module

**Files:**
- Create: `assets/js/tournament-groups.js`
- Create: `tests/tournament-groups.test.js`

- [ ] **Step 1: Write the failing group setup tests**

Create `tests/tournament-groups.test.js` with:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadBrowserScript(relativePath, sandbox) {
  const code = fs.readFileSync(path.join(root, relativePath), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: relativePath });
  return sandbox;
}

function makeSandbox() {
  const sandbox = { window: {} };
  sandbox.window = sandbox;
  return sandbox;
}

test('parseTeamList trims blank lines and removes empty teams', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-groups.js', sandbox);

  assert.deepEqual(
    sandbox.window.RHMTournamentGroups.parseTeamList('Aqsa\n\n EH Warriors \nStrap Kings'),
    ['Aqsa', 'EH Warriors', 'Strap Kings']
  );
});

test('seeded snake grouping balances strong seeds across groups', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-groups.js', sandbox);

  const groups = sandbox.window.RHMTournamentGroups.buildGroupsFromTeamList({
    teams: ['Seed 1', 'Seed 2', 'Seed 3', 'Seed 4', 'Seed 5', 'Seed 6'],
    numGroups: 3,
    method: 'seeded'
  });

  assert.deepEqual(groups.map(group => group.teams), [
    ['Seed 1', 'Seed 6'],
    ['Seed 2', 'Seed 5'],
    ['Seed 3', 'Seed 4']
  ]);
});

test('random grouping is deterministic when a random function is provided', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-groups.js', sandbox);

  const groups = sandbox.window.RHMTournamentGroups.buildGroupsFromTeamList({
    teams: ['A', 'B', 'C', 'D'],
    numGroups: 2,
    method: 'random',
    random: () => 0.9
  });

  assert.deepEqual(groups.map(group => group.teams), [
    ['D', 'B'],
    ['C', 'A']
  ]);
});

test('normalizeManualGroups keeps manually created groups and removes blanks', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-groups.js', sandbox);

  const groups = sandbox.window.RHMTournamentGroups.normalizeManualGroups([
    { name: 'Pool A', teams: [' A ', '', 'B'] },
    { name: '', teams: ['C'] }
  ]);

  assert.deepEqual(groups, [
    { id: 'group-a', name: 'Pool A', teams: ['A', 'B'] },
    { id: 'group-b', name: 'Group B', teams: ['C'] }
  ]);
});

test('defaultVenueNames uses courts for basketball and fields for football or soccer', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-groups.js', sandbox);

  assert.deepEqual(sandbox.window.RHMTournamentGroups.defaultVenueNames('Basketball', 2), ['Court 1', 'Court 2']);
  assert.deepEqual(sandbox.window.RHMTournamentGroups.defaultVenueNames('Flag Football', 2), ['Field 1', 'Field 2']);
  assert.deepEqual(sandbox.window.RHMTournamentGroups.defaultVenueNames('Soccer', 1), ['Field 1']);
});
```

- [ ] **Step 2: Run the group tests to verify they fail**

Run:

```bash
node --test tests/tournament-groups.test.js
```

Expected: FAIL because `assets/js/tournament-groups.js` does not exist.

- [ ] **Step 3: Implement the group setup module**

Create `assets/js/tournament-groups.js` with:

```js
(function (window) {
  var GROUP_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  function cleanTeam(team) {
    return String(team || '').trim();
  }

  function parseTeamList(value) {
    return String(value || '')
      .split(/\r?\n|,/)
      .map(cleanTeam)
      .filter(Boolean);
  }

  function groupId(index) {
    return 'group-' + GROUP_LABELS[index].toLowerCase();
  }

  function normalizeManualGroups(groups) {
    return (groups || []).map(function (group, index) {
      var name = cleanTeam(group.name) || 'Group ' + GROUP_LABELS[index];
      return {
        id: group.id || groupId(index),
        name: name,
        teams: (group.teams || []).map(cleanTeam).filter(Boolean)
      };
    }).filter(function (group) {
      return group.teams.length > 0;
    });
  }

  function shuffleWithRandom(teams, random) {
    var copy = teams.slice();
    var rand = typeof random === 'function' ? random : Math.random;
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function emptyGroups(numGroups) {
    var count = Math.max(1, parseInt(numGroups, 10) || 1);
    return Array.from({ length: count }, function (_, index) {
      return { id: groupId(index), name: 'Group ' + GROUP_LABELS[index], teams: [] };
    });
  }

  function distributeSnake(teams, numGroups) {
    var groups = emptyGroups(numGroups);
    teams.forEach(function (team, index) {
      var round = Math.floor(index / groups.length);
      var position = index % groups.length;
      var groupIndex = round % 2 === 0 ? position : groups.length - 1 - position;
      groups[groupIndex].teams.push(team);
    });
    return groups;
  }

  function distributeStraight(teams, numGroups) {
    var groups = emptyGroups(numGroups);
    teams.forEach(function (team, index) {
      groups[index % groups.length].teams.push(team);
    });
    return groups;
  }

  function buildGroupsFromTeamList(options) {
    var sourceTeams = Array.isArray(options.teams) ? options.teams : parseTeamList(options.teams);
    var teams = sourceTeams.map(cleanTeam).filter(Boolean);
    var numGroups = Math.max(1, parseInt(options.numGroups, 10) || 1);
    var method = options.method || 'seeded';

    if (method === 'random') {
      return distributeStraight(shuffleWithRandom(teams, options.random), numGroups);
    }

    return distributeSnake(teams, numGroups);
  }

  function defaultVenueNames(sport, count) {
    var isCourt = /basketball/i.test(String(sport || ''));
    var label = isCourt ? 'Court' : 'Field';
    var total = Math.max(1, parseInt(count, 10) || 1);
    return Array.from({ length: total }, function (_, index) {
      return label + ' ' + (index + 1);
    });
  }

  window.RHMTournamentGroups = {
    parseTeamList: parseTeamList,
    normalizeManualGroups: normalizeManualGroups,
    buildGroupsFromTeamList: buildGroupsFromTeamList,
    defaultVenueNames: defaultVenueNames
  };
})(window);
```

- [ ] **Step 4: Run the group tests to verify they pass**

Run:

```bash
node --test tests/tournament-groups.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add assets/js/tournament-groups.js tests/tournament-groups.test.js
git commit -m "feat: add tournament group setup helpers"
```

---

### Task 2: Fixture Scheduler and Validation Engine

**Files:**
- Modify: `assets/js/tournament-engine.js`
- Modify: `tests/tournament-engine.test.js`

- [ ] **Step 1: Add failing scheduler tests**

Append these tests to `tests/tournament-engine.test.js`:

```js
test('generateDivisionSchedule creates group and playoff fixtures with seed placeholders', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateDivisionSchedule({
    divisionId: 'adult',
    settings: {
      sport: 'Flag Football',
      startTime: '10:00',
      gameDuration: 20,
      breakBetween: 5,
      breakBeforePlayoffs: 30,
      playoffGameDuration: 25,
      playoffFormat: 'top2'
    },
    venues: [
      { id: 'field-1', name: 'Field 1' },
      { id: 'field-2', name: 'Field 2' }
    ],
    groups: [
      { id: 'group-a', name: 'Group A', teams: ['A1', 'A2', 'A3'] },
      { id: 'group-b', name: 'Group B', teams: ['B1', 'B2', 'B3'] }
    ],
    blockedWindows: []
  });

  assert.equal(result.fixtures.filter(fixture => fixture.phase === 'group').length, 6);
  assert.equal(result.fixtures.filter(fixture => fixture.phase === 'playoff').length, 3);
  assert.equal(result.fixtures.find(fixture => fixture.phase === 'playoff').seedA.label, 'Group A Seed 1');
});

test('generateDivisionSchedule respects venue blocks', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateDivisionSchedule({
    divisionId: 'adult',
    settings: {
      startTime: '10:00',
      gameDuration: 20,
      breakBetween: 0,
      breakBeforePlayoffs: 0,
      playoffGameDuration: 20,
      playoffFormat: 'top1'
    },
    venues: [
      { id: 'field-1', name: 'Field 1' },
      { id: 'field-2', name: 'Field 2' }
    ],
    groups: [
      { id: 'group-a', name: 'Group A', teams: ['A1', 'A2'] },
      { id: 'group-b', name: 'Group B', teams: ['B1', 'B2'] }
    ],
    blockedWindows: [
      { venueId: 'field-1', startSlot: 0, endSlot: 1, reason: 'Setup' }
    ]
  });

  assert.equal(result.fixtures.some(fixture => fixture.venueId === 'field-1' && fixture.slot === 0), false);
});

test('validateFixtureMove blocks team conflicts and blocked windows', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const fixtures = [
    { id: 'f1', teamA: 'A', teamB: 'B', venueId: 'field-1', slot: 0 },
    { id: 'f2', teamA: 'A', teamB: 'C', venueId: 'field-2', slot: 1 }
  ];

  assert.deepEqual(
    sandbox.window.RHMTournamentEngine.validateFixtureMove({
      fixtureId: 'f2',
      fixtures,
      targetVenueId: 'field-2',
      targetSlot: 0,
      blockedWindows: []
    }),
    { ok: false, reason: 'A already plays at this time.' }
  );

  assert.deepEqual(
    sandbox.window.RHMTournamentEngine.validateFixtureMove({
      fixtureId: 'f2',
      fixtures,
      targetVenueId: 'field-2',
      targetSlot: 2,
      blockedWindows: [{ venueId: 'field-2', startSlot: 2, endSlot: 3, reason: 'Prayer break' }]
    }),
    { ok: false, reason: 'Field/court is blocked: Prayer break.' }
  );
});
```

- [ ] **Step 2: Run scheduler tests to verify they fail**

Run:

```bash
node --test tests/tournament-engine.test.js
```

Expected: FAIL because `generateDivisionSchedule` and `validateFixtureMove` are not defined.

- [ ] **Step 3: Replace `assets/js/tournament-engine.js` with a fixture-based engine**

Replace the file with an IIFE that keeps the existing public functions and adds these function signatures:

```js
function generateDivisionSchedule(input) {
  return { settings: input.settings || {}, groups: input.groups || [], fixtures: [], summary: {} };
}

function validateFixtureMove(options) {
  return { ok: true };
}

function moveFixture(options) {
  var validation = validateFixtureMove(options);
  if (!validation.ok) return validation;
  return { ok: true, fixtures: (options.fixtures || []).map(function (fixture) {
    if (fixture.id !== options.fixtureId) return fixture;
    return Object.assign({}, fixture, { venueId: options.targetVenueId, slot: options.targetSlot });
  }) };
}

function generateRoundRobinFixtures(divisionId, groups) {
  return [];
}

function scheduleFixtures(fixtures, options) {
  return fixtures;
}

function buildPlayoffFixtures(options) {
  return [];
}
```

Implementation requirements:

- Preserve `generateSchedule(input)` by adapting its result from `generateDivisionSchedule(input)` so existing UI still works during migration.
- Export all current names: `generateSchedule`, `getActiveFieldCount`, `getTimeSlots`, `buildPlayoffs`.
- Export new names: `generateDivisionSchedule`, `validateFixtureMove`, `moveFixture`, `buildPlayoffFixtures`.
- Use fixture ids like `adult-group-0`, `adult-playoff-0`.
- Store playoff seed placeholders as `{ groupId, groupName, seed, label }`.
- Use `startsAt` in `HH:MM` format.
- Treat `blockedWindows` as slot-based objects with `{ venueId: 'all' | venueId, startSlot, endSlot, reason }`.
- A block applies when `slot >= startSlot && slot < endSlot`.

Use this exact validation behavior:

```js
function teamsForFixture(fixture) {
  return [fixture.teamA, fixture.teamB].filter(Boolean);
}

function isBlocked(venueId, slot, blockedWindows) {
  return (blockedWindows || []).find(function (block) {
    var appliesToVenue = block.venueId === 'all' || block.venueId === venueId;
    return appliesToVenue && slot >= block.startSlot && slot < block.endSlot;
  });
}

function validateFixtureMove(options) {
  var moving = (options.fixtures || []).find(function (fixture) {
    return fixture.id === options.fixtureId;
  });
  if (!moving) return { ok: false, reason: 'Fixture not found.' };

  var block = isBlocked(options.targetVenueId, options.targetSlot, options.blockedWindows || []);
  if (block) return { ok: false, reason: 'Field/court is blocked: ' + (block.reason || 'Unavailable') + '.' };

  var venueConflict = (options.fixtures || []).find(function (fixture) {
    return fixture.id !== moving.id && fixture.venueId === options.targetVenueId && fixture.slot === options.targetSlot;
  });
  if (venueConflict) return { ok: false, reason: 'Field/court already has a game at this time.' };

  var movingTeams = new Set(teamsForFixture(moving));
  var teamConflict = (options.fixtures || []).find(function (fixture) {
    if (fixture.id === moving.id || fixture.slot !== options.targetSlot) return false;
    return teamsForFixture(fixture).some(function (team) { return movingTeams.has(team); });
  });
  if (teamConflict) {
    var team = teamsForFixture(teamConflict).find(function (name) { return movingTeams.has(name); });
    return { ok: false, reason: team + ' already plays at this time.' };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run scheduler tests to verify they pass**

Run:

```bash
node --test tests/tournament-engine.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add assets/js/tournament-engine.js tests/tournament-engine.test.js
git commit -m "feat: add fixture scheduler and move validation"
```

---

### Task 3: Standings and Seeding Module

**Files:**
- Create: `assets/js/tournament-standings.js`
- Create: `tests/tournament-standings.test.js`

- [ ] **Step 1: Write failing standings tests**

Create `tests/tournament-standings.test.js` with:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadBrowserScript(relativePath, sandbox) {
  const code = fs.readFileSync(path.join(root, relativePath), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: relativePath });
  return sandbox;
}

function makeSandbox() {
  const sandbox = { window: {} };
  sandbox.window = sandbox;
  return sandbox;
}

test('computeStandings uses configurable points and point differential before head to head', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-standings.js', sandbox);

  const standings = sandbox.window.RHMTournamentStandings.computeStandings({
    groups: [{ id: 'group-a', name: 'Group A', teams: ['A', 'B', 'C'] }],
    fixtures: [
      { phase: 'group', groupId: 'group-a', teamA: 'A', teamB: 'B', scoreA: 8, scoreB: 0, status: 'final' },
      { phase: 'group', groupId: 'group-a', teamA: 'A', teamB: 'C', scoreA: 0, scoreB: 1, status: 'final' },
      { phase: 'group', groupId: 'group-a', teamA: 'B', teamB: 'C', scoreA: 3, scoreB: 0, status: 'final' }
    ],
    rules: { winPoints: 3, drawPoints: 1, lossPoints: 0, tiesAllowed: false }
  });

  assert.deepEqual(standings[0].rows.map(row => row.team), ['A', 'B', 'C']);
  assert.equal(standings[0].rows[0].diff, 7);
});

test('seed overrides force projected seed order', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-standings.js', sandbox);

  const standings = [{
    groupId: 'group-a',
    groupName: 'Group A',
    rows: [
      { team: 'A', rank: 1 },
      { team: 'B', rank: 2 }
    ]
  }];

  const seeds = sandbox.window.RHMTournamentStandings.projectSeeds({
    standings,
    advancePerGroup: 2,
    seedOverrides: [{ groupId: 'group-a', seed: 1, team: 'B' }]
  });

  assert.deepEqual(seeds.map(seed => seed.team), ['B', 'A']);
});
```

- [ ] **Step 2: Run standings tests to verify they fail**

Run:

```bash
node --test tests/tournament-standings.test.js
```

Expected: FAIL because `assets/js/tournament-standings.js` does not exist.

- [ ] **Step 3: Implement standings calculations**

Create `assets/js/tournament-standings.js` with exported functions:

```js
computeStandings({ groups, fixtures, rules })
projectSeeds({ standings, advancePerGroup, seedOverrides })
applySeedOverrides(rows, groupId, seedOverrides)
```

Implementation requirements:

- Count only `phase === 'group'` fixtures with numeric `scoreA` and `scoreB`.
- Treat score ties as draws only when `rules.tiesAllowed !== false`.
- Default points: win 3, draw 1, loss 0.
- Sort rows by `points`, `wins`, `diff`, head-to-head result, points scored, then team name.
- Return rows with `{ team, rank, played, wins, losses, draws, points, pf, pa, diff }`.
- `projectSeeds` returns seed objects with `{ groupId, groupName, seed, team, label }`.
- Seed override for one seed moves that team to that seed and fills remaining seeds from standings order without duplicates.

- [ ] **Step 4: Run standings tests to verify they pass**

Run:

```bash
node --test tests/tournament-standings.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add assets/js/tournament-standings.js tests/tournament-standings.test.js
git commit -m "feat: add configurable tournament standings"
```

---

### Task 4: Draft and Publish Store Behavior

**Files:**
- Modify: `assets/js/tournament-store.js`
- Modify: `tests/helpers.test.js`

- [ ] **Step 1: Add failing store tests**

Append to `tests/helpers.test.js`:

```js
test('tournament store hides drafts from public loads', async () => {
  const sandbox = makeSandbox();
  sandbox.window.RHM_SUPABASE_CONFIG_OVERRIDE = {
    url: 'https://your-project-ref.supabase.co',
    anonKey: 'your-supabase-anon-key'
  };

  loadBrowserScript('assets/js/supabase-config.js', sandbox);
  loadBrowserScript('assets/js/tournament-store.js', sandbox);

  await sandbox.window.RHMTournamentStore.saveTournamentState({ id: 't1', status: 'draft', divisions: [] });

  assert.equal(await sandbox.window.RHMTournamentStore.loadPublicTournamentState(), null);
  assert.equal((await sandbox.window.RHMTournamentStore.loadTournamentState()).status, 'draft');
});

test('publishTournamentState marks local tournament as published', async () => {
  const sandbox = makeSandbox();
  sandbox.window.RHM_SUPABASE_CONFIG_OVERRIDE = {
    url: 'https://your-project-ref.supabase.co',
    anonKey: 'your-supabase-anon-key'
  };

  loadBrowserScript('assets/js/supabase-config.js', sandbox);
  loadBrowserScript('assets/js/tournament-store.js', sandbox);

  const published = await sandbox.window.RHMTournamentStore.publishTournamentState({ id: 't1', status: 'draft', divisions: [] });

  assert.equal(published.status, 'published');
  assert.equal(typeof published.publishedAt, 'string');
  assert.equal((await sandbox.window.RHMTournamentStore.loadPublicTournamentState()).status, 'published');
});
```

- [ ] **Step 2: Run store tests to verify they fail**

Run:

```bash
node --test tests/helpers.test.js
```

Expected: FAIL because `loadPublicTournamentState` and `publishTournamentState` are not defined.

- [ ] **Step 3: Add draft/publish helpers to `tournament-store.js`**

Modify `assets/js/tournament-store.js`:

- Add `loadPublicTournamentState()`.
- Add `publishTournamentState(state)`.
- Add `unpublishTournamentState(state)`.
- Keep `loadTournamentState()`, `saveTournamentState(state)`, and `clearTournamentState()` compatible with current callers.
- For local fallback, `loadPublicTournamentState()` should return the saved state only when `state.status === 'published'`.
- For Supabase, keep using the single `tournament_state` row and filter public visibility in the returned JSON until schema changes are needed.

Use this local behavior:

```js
async function loadPublicTournamentState() {
  var state = await loadTournamentState();
  return state && state.status === 'published' ? state : null;
}

async function publishTournamentState(state) {
  var next = Object.assign({}, state, {
    status: 'published',
    publishedAt: new Date().toISOString(),
    activePublicTournament: true
  });
  return saveTournamentState(next);
}

async function unpublishTournamentState(state) {
  var next = Object.assign({}, state, {
    status: 'draft',
    activePublicTournament: false
  });
  return saveTournamentState(next);
}
```

Export the new methods on `window.RHMTournamentStore`.

- [ ] **Step 4: Run store tests to verify they pass**

Run:

```bash
node --test tests/helpers.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add assets/js/tournament-store.js tests/helpers.test.js
git commit -m "feat: add tournament draft publish state"
```

---

### Task 5: Admin Page Integration

**Files:**
- Modify: `admin-bracket.html`

- [ ] **Step 1: Add script dependencies**

In `admin-bracket.html`, add these scripts between `admin-auth.js` and `tournament-engine.js`:

```html
<script src="assets/js/tournament-groups.js"></script>
<script src="assets/js/tournament-standings.js"></script>
```

- [ ] **Step 2: Update default state**

Replace `mkDefault()` with a division-aware state:

```js
function mkDefault() {
  return {
    id: 'active',
    status: 'draft',
    activePublicTournament: false,
    settings: { name:'', sport:'Flag Football' },
    divisions: [{
      id: 'division-main',
      name: 'Main Division',
      sport: 'Flag Football',
      setupMode: 'manual-groups',
      schedulingMode: 'shared',
      settings: {
        numGroups: 2,
        numFields: 2,
        gameDuration: 25,
        breakBetween: 5,
        breakBeforePlayoffs: 30,
        playoffGameDuration: 25,
        startTime: '10:00',
        playoffFormat: 'top2',
        winPoints: 3,
        drawPoints: 1,
        lossPoints: 0,
        tiesAllowed: false
      },
      teamList: '',
      groups: [
        { id:'group-a', name:'Group A', teams:['','','',''] },
        { id:'group-b', name:'Group B', teams:['','','',''] }
      ],
      venues: [
        { id:'venue-1', name:'Field 1' },
        { id:'venue-2', name:'Field 2' }
      ],
      blockedWindows: [],
      fixtures: [],
      seedOverrides: []
    }]
  };
}

function activeDivision() {
  if (!S.divisions || !S.divisions.length) S = mkDefault();
  return S.divisions[0];
}
```

- [ ] **Step 3: Keep backward compatibility for saved old state**

Inside `tryLoad()`, after loading `d`, normalize old saved state:

```js
function migrateLoadedState(state) {
  if (!state || state.divisions) return state;
  const migrated = mkDefault();
  migrated.settings = state.settings || migrated.settings;
  migrated.divisions[0].settings = Object.assign({}, migrated.divisions[0].settings, state.settings || {});
  migrated.divisions[0].groups = state.groups || migrated.divisions[0].groups;
  migrated.divisions[0].fixtures = (state.schedule || []).map(g => ({
    id: g.id,
    divisionId: 'division-main',
    phase: 'group',
    groupId: 'group-' + GL[g.gi].toLowerCase(),
    groupName: g.gName,
    teamA: g.tA,
    teamB: g.tB,
    venueId: 'venue-' + (g.field + 1),
    venueName: 'Field ' + (g.field + 1),
    slot: g.slot,
    startsAt: g.time,
    scoreA: g.scoreA,
    scoreB: g.scoreB,
    ref: g.ref || '',
    status: g.scoreA !== null && g.scoreB !== null ? 'final' : 'scheduled'
  }));
  return migrated;
}
```

Call `S = migrateLoadedState(d);`.

- [ ] **Step 4: Add setup controls without changing the page style**

Add controls in the existing setup card:

```html
<div class="f-row">
  <label class="f-label" for="t-setup-mode">Setup Mode</label>
  <select class="f-select" id="t-setup-mode" onchange="onSetupModeChange()">
    <option value="manual-groups">Create Groups</option>
    <option value="team-list">List All Teams</option>
  </select>
</div>
<div class="f-row" id="team-list-wrap" style="display:none;">
  <label class="f-label" for="t-team-list">Team List</label>
  <textarea class="f-input" id="t-team-list" rows="8" placeholder="One team per line"></textarea>
</div>
<div class="f-row" id="group-method-wrap" style="display:none;">
  <label class="f-label" for="t-group-method">Group Draw</label>
  <select class="f-select" id="t-group-method">
    <option value="seeded">Seeded snake</option>
    <option value="random">Random draw</option>
  </select>
</div>
```

- [ ] **Step 5: Generate division fixtures**

Replace the body of `generateSchedule()` with:

```js
function generateSchedule() {
  const div = activeDivision();
  S.settings = readTournamentSettings();
  div.settings = readSettings();
  div.sport = S.settings.sport;

  if (div.setupMode === 'team-list') {
    div.teamList = document.getElementById('t-team-list').value;
    div.groups = window.RHMTournamentGroups.buildGroupsFromTeamList({
      teams: div.teamList,
      numGroups: div.settings.numGroups,
      method: document.getElementById('t-group-method').value
    });
  } else {
    div.groups = window.RHMTournamentGroups.normalizeManualGroups(div.groups);
  }

  const result = window.RHMTournamentEngine.generateDivisionSchedule({
    divisionId: div.id,
    settings: div.settings,
    groups: div.groups,
    venues: div.venues,
    blockedWindows: div.blockedWindows
  });

  div.fixtures = result.fixtures;
  div.scheduleSummary = result.summary;
  save();
  switchTab('schedule');
}
```

Keep compatibility helpers for rendering by either converting `div.fixtures` to the current table shape or updating `renderSchedule()` directly to use fixtures.

- [ ] **Step 6: Add drag/drop validation hooks**

In rendered fixture cards, add:

```html
draggable="true" ondragstart="onFixtureDragStart(event,'FIXTURE_ID')" ondragover="onFixtureDragOver(event)" ondrop="onFixtureDrop(event,'VENUE_ID',SLOT)"
```

Add JS:

```js
let draggingFixtureId = null;

function onFixtureDragStart(event, fixtureId) {
  draggingFixtureId = fixtureId;
  event.dataTransfer.setData('text/plain', fixtureId);
}

function onFixtureDragOver(event) {
  event.preventDefault();
}

function onFixtureDrop(event, venueId, slot) {
  event.preventDefault();
  const div = activeDivision();
  const fixtureId = event.dataTransfer.getData('text/plain') || draggingFixtureId;
  const result = window.RHMTournamentEngine.moveFixture({
    fixtureId,
    fixtures: div.fixtures,
    targetVenueId: venueId,
    targetSlot: slot,
    blockedWindows: div.blockedWindows
  });
  if (!result.ok) {
    alert(result.reason);
    return;
  }
  div.fixtures = result.fixtures;
  save();
  renderSchedule();
}
```

- [ ] **Step 7: Add publish controls**

Add buttons near the schedule header:

```html
<button class="btn-primary" onclick="publishTournament()">Publish</button>
<button class="btn-reset" onclick="unpublishTournament()">Unpublish</button>
```

Add JS:

```js
async function publishTournament() {
  S = await window.RHMTournamentStore.publishTournamentState(S);
  renderPublishStatus();
}

async function unpublishTournament() {
  S = await window.RHMTournamentStore.unpublishTournamentState(S);
  renderPublishStatus();
}

function renderPublishStatus() {
  const node = document.getElementById('publish-status');
  if (node) node.textContent = S.status === 'published' ? 'Published' : 'Draft';
}
```

- [ ] **Step 8: Manual admin verification**

Run:

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173/admin-bracket.html`.

Expected:

- Existing admin auth still gates the page.
- Manual group setup renders.
- Team list setup can generate groups.
- Schedule generation produces group and playoff fixtures.
- Dragging a fixture into a team conflict shows an error.
- Score Save still persists.
- Publish button changes status to published.

- [ ] **Step 9: Commit Task 5**

Run:

```bash
git add admin-bracket.html
git commit -m "feat: wire admin tournament manager"
```

---

### Task 6: Public Live Page Tabs and Published State

**Files:**
- Modify: `tournament-live.html`

- [ ] **Step 1: Add script dependencies**

In `tournament-live.html`, add:

```html
<script src="assets/js/tournament-standings.js"></script>
```

before `tournament-engine.js`.

- [ ] **Step 2: Load only public state**

Replace:

```js
return await window.RHMTournamentStore.loadTournamentState();
```

with:

```js
return await window.RHMTournamentStore.loadPublicTournamentState();
```

- [ ] **Step 3: Add public view tabs**

In the rendered HTML after the hero, add:

```js
html += `
  <div class="tab-nav" style="margin-top:1.5rem;">
    <button class="tab-btn active" data-live-tab="schedule" onclick="switchLiveTab('schedule')">Schedule</button>
    <button class="tab-btn" data-live-tab="standings" onclick="switchLiveTab('standings')">Standings</button>
    <button class="tab-btn" data-live-tab="bracket" onclick="switchLiveTab('bracket')">Bracket</button>
  </div>
`;
```

Wrap each section with concrete containers like these:

```html
<div class="live-panel active" id="live-panel-schedule">
  <div class="sec-wrap" id="public-schedule-section"></div>
</div>
<div class="live-panel" id="live-panel-standings">
  <div class="sec-wrap" id="public-standings-section"></div>
</div>
<div class="live-panel" id="live-panel-bracket">
  <div class="sec-wrap" id="public-bracket-section"></div>
</div>
```

Add JS:

```js
function switchLiveTab(tab) {
  document.querySelectorAll('[data-live-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.liveTab === tab);
  });
  document.querySelectorAll('.live-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === 'live-panel-' + tab);
  });
}
```

Add CSS:

```css
.live-panel { display: none; }
.live-panel.active { display: block; }
```

- [ ] **Step 4: Render division fixtures**

Update the public rendering logic to use `const div = S.divisions[0];` and `div.fixtures` instead of old `S.schedule`.

Expected behavior:

- Group fixtures and playoff fixtures both appear in Schedule.
- Unscored fixtures show teams or seed labels.
- Scored fixtures show winner emphasis.
- Standings use `RHMTournamentStandings.computeStandings`.
- Bracket uses projected seeds and playoff fixture scores.

- [ ] **Step 5: Manual public verification**

Run:

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173/tournament-live.html`.

Expected:

- Draft tournament shows "No Tournament Active".
- Published tournament shows Schedule, Standings, and Bracket tabs.
- Refresh after admin score save shows updated public standings.

- [ ] **Step 6: Commit Task 6**

Run:

```bash
git add tournament-live.html
git commit -m "feat: show published tournament live tabs"
```

---

### Task 7: Full Regression and Polish Pass

**Files:**
- Modify only files needed by failures found during this task.

- [ ] **Step 1: Run all automated tests**

Run:

```bash
node --test tests/*.test.js
```

Expected: PASS.

- [ ] **Step 2: Run a local static server**

Run:

```bash
python3 -m http.server 4173
```

Expected: server starts at `http://localhost:4173`.

- [ ] **Step 3: Complete the manual tournament path**

In the browser:

1. Open `http://localhost:4173/admin-bracket.html`.
2. Create a 2-group, 6-team tournament.
3. Generate the schedule.
4. Confirm no team appears twice in the same time slot.
5. Drag a fixture into an invalid same-team slot and confirm the move is blocked.
6. Drag a fixture into a valid empty slot and confirm the move saves.
7. Enter all group scores with Save buttons.
8. Confirm standings use point differential before head-to-head.
9. Confirm playoff teams appear from projected seeds.
10. Publish the tournament.
11. Open `http://localhost:4173/tournament-live.html`.
12. Confirm public Schedule, Standings, and Bracket tabs render.
13. Enter a playoff score in admin and confirm public bracket updates after refresh.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: only intentional files from the current task are modified.

- [ ] **Step 5: Commit fixes from regression pass**

If files changed, run:

```bash
git add assets/js/tournament-groups.js assets/js/tournament-engine.js assets/js/tournament-standings.js assets/js/tournament-store.js admin-bracket.html tournament-live.html tests/tournament-groups.test.js tests/tournament-engine.test.js tests/tournament-standings.test.js tests/helpers.test.js
git commit -m "fix: stabilize tournament manager flow"
```

If no files changed, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Group setup modes are covered in Task 1 and Task 5.
- Random and seeded grouping are covered in Task 1.
- Fixture scheduling, venue names, hard validation, venue blocks, and playoff fixtures are covered in Task 2 and Task 5.
- Standings rules, point differential before head-to-head, and seed overrides are covered in Task 3.
- Draft and publish visibility are covered in Task 4 and Task 6.
- Admin editing, drag/drop, score saving, and publish controls are covered in Task 5.
- Public tabs are covered in Task 6.
- Regression and manual tournament-day verification are covered in Task 7.

Placeholder scan:

- No task contains unresolved implementation markers.
- Every test task includes concrete tests and commands.
- UI integration tasks include the exact functions and markup required for the first implementation pass.

Type consistency:

- The plan consistently uses `divisions`, `fixtures`, `venues`, `blockedWindows`, `seedOverrides`, `status`, and `publishedAt`.
- New browser globals are `RHMTournamentGroups`, `RHMTournamentEngine`, `RHMTournamentStandings`, and `RHMTournamentStore`.
- Fixture properties consistently use `teamA`, `teamB`, `venueId`, `slot`, `startsAt`, `scoreA`, `scoreB`, and `status`.
