# Schedule Import + Events System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CSV/Excel schedule import to the bracket admin tool, a Tournament Format selector, and a fully localStorage-backed events management + public display system.

**Architecture:** Parser logic lives in a new `assets/js/schedule-import.js` module (testable in Node.js via vm sandbox). Events use a localStorage layer added to the existing `events-store.js`. All four HTML pages are updated to read/write `rhm_events`. The `groupName` field on fixtures is the single source of truth for standings labels — never hardcoded in display code.

**Tech Stack:** Vanilla JS (ES5-compatible IIFE pattern matching existing codebase), Node.js `node:test` + `node:vm` for unit tests, SheetJS from CDN for XLSX, localStorage for event and tournament persistence.

---

## File Map

| File | Change |
|------|--------|
| `assets/js/events-store.js` | Add `saveLocalEvent`, `listLocalEvents`, `deleteLocalEvent`, `getLinkedEvent`; add `tournamentLinked` to `normalizeEvent` |
| `assets/js/schedule-import.js` | **New.** CSV parser, format detector, matrix/flat parsers, fixture builder |
| `tests/events-store.test.js` | **New.** Unit tests for localStorage layer |
| `tests/schedule-import.test.js` | **New.** Unit tests for parser |
| `admin-events.html` | Replace Supabase calls with localStorage; add Edit/Delete/Link Tournament |
| `events.html` | Dynamic rendering from `rhm_events`; tournament-linked button |
| `tournament-live.html` | Linked event banner; standings already dynamic (verify) |
| `admin-bracket.html` | Tournament Format selector; import section UI; wire to schedule-import.js |

---

## Task 1: events-store.js — localStorage layer (TDD)

**Files:**
- Modify: `assets/js/events-store.js`
- Create: `tests/events-store.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/events-store.test.js`:

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

function loadEventsStore(sb) {
  // events-store.js requires window.RHM — provide a stub
  sb.window.RHM = null;
  return loadScript('assets/js/events-store.js', sb);
}

test('listLocalEvents returns [] when nothing stored', () => {
  const sb = makeSandbox();
  loadEventsStore(sb);
  assert.deepEqual(sb.window.RHMEventsStore.listLocalEvents(), []);
});

test('saveLocalEvent inserts a new event', () => {
  const sb = makeSandbox();
  loadEventsStore(sb);
  const store = sb.window.RHMEventsStore;
  store.saveLocalEvent({ id: '1', name: 'Test', tournamentLinked: false });
  const events = store.listLocalEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'Test');
});

test('saveLocalEvent updates existing event by id', () => {
  const sb = makeSandbox();
  loadEventsStore(sb);
  const store = sb.window.RHMEventsStore;
  store.saveLocalEvent({ id: '1', name: 'Original', tournamentLinked: false });
  store.saveLocalEvent({ id: '1', name: 'Updated', tournamentLinked: false });
  const events = store.listLocalEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'Updated');
});

test('deleteLocalEvent removes event by id', () => {
  const sb = makeSandbox();
  loadEventsStore(sb);
  const store = sb.window.RHMEventsStore;
  store.saveLocalEvent({ id: '1', name: 'A', tournamentLinked: false });
  store.saveLocalEvent({ id: '2', name: 'B', tournamentLinked: false });
  store.deleteLocalEvent('1');
  const events = store.listLocalEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].id, '2');
});

test('getLinkedEvent returns null when no linked event', () => {
  const sb = makeSandbox();
  loadEventsStore(sb);
  const store = sb.window.RHMEventsStore;
  store.saveLocalEvent({ id: '1', name: 'A', tournamentLinked: false });
  assert.equal(store.getLinkedEvent(), null);
});

test('getLinkedEvent returns the linked event', () => {
  const sb = makeSandbox();
  loadEventsStore(sb);
  const store = sb.window.RHMEventsStore;
  store.saveLocalEvent({ id: '1', name: 'A', tournamentLinked: false });
  store.saveLocalEvent({ id: '2', name: 'B', tournamentLinked: true });
  const linked = store.getLinkedEvent();
  assert.ok(linked);
  assert.equal(linked.id, '2');
});

test('normalizeEvent passes through tournamentLinked', () => {
  const sb = makeSandbox();
  loadEventsStore(sb);
  const store = sb.window.RHMEventsStore;
  const normalized = store.normalizeEvent({ id: '1', title: 'X', tournamentLinked: true });
  assert.equal(normalized.tournamentLinked, true);
  const normalized2 = store.normalizeEvent({ id: '2', title: 'Y' });
  assert.equal(normalized2.tournamentLinked, false);
});
```

- [ ] **Step 2: Run tests and confirm they all fail**

```bash
node --test tests/events-store.test.js 2>&1 | grep -E "^# (pass|fail)|not ok"
```

Expected: several failures (functions not yet defined).

- [ ] **Step 3: Add localStorage layer to events-store.js**

Open `assets/js/events-store.js`. Add these four functions right before the `window.RHMEventsStore = {` line (around line 204):

```js
  var LS_EVENTS = 'rhm_events';

  function listLocalEvents() {
    try {
      return JSON.parse(window.localStorage.getItem(LS_EVENTS) || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveLocalEvent(event) {
    var events = listLocalEvents();
    var idx = -1;
    for (var i = 0; i < events.length; i++) {
      if (events[i].id === event.id) { idx = i; break; }
    }
    if (idx >= 0) {
      events[idx] = event;
    } else {
      events.push(event);
    }
    window.localStorage.setItem(LS_EVENTS, JSON.stringify(events));
  }

  function deleteLocalEvent(id) {
    var events = listLocalEvents().filter(function (e) { return e.id !== id; });
    window.localStorage.setItem(LS_EVENTS, JSON.stringify(events));
  }

  function getLinkedEvent() {
    var events = listLocalEvents();
    for (var i = 0; i < events.length; i++) {
      if (events[i].tournamentLinked === true) return events[i];
    }
    return null;
  }
```

- [ ] **Step 4: Add `tournamentLinked` to `normalizeEvent`**

In `normalizeEvent`, after the `description` line add:

```js
      tournamentLinked: record.tournamentLinked === true,
```

- [ ] **Step 5: Export new functions in `window.RHMEventsStore`**

Add to the object literal at the bottom:

```js
    listLocalEvents: listLocalEvents,
    saveLocalEvent: saveLocalEvent,
    deleteLocalEvent: deleteLocalEvent,
    getLinkedEvent: getLinkedEvent,
```

- [ ] **Step 6: Run tests — all 7 should pass**

```bash
node --test tests/events-store.test.js 2>&1 | grep -E "^# (pass|fail)"
```

Expected: `# pass 7` / `# fail 0`

- [ ] **Step 7: Run full test suite to confirm no regressions**

```bash
node --test 2>&1 | grep -E "^# (pass|fail)"
```

Expected: `# pass 45` / `# fail 0`

- [ ] **Step 8: Commit**

```bash
git add assets/js/events-store.js tests/events-store.test.js
git commit -m "feat: add localStorage layer to events-store (listLocalEvents, saveLocalEvent, deleteLocalEvent, getLinkedEvent)"
```

---

## Task 2: schedule-import.js — CSV parser + format detection (TDD)

**Files:**
- Create: `assets/js/schedule-import.js`
- Create: `tests/schedule-import.test.js`

- [ ] **Step 1: Write failing tests for CSV parser and format detection**

Create `tests/schedule-import.test.js`:

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
  const sb = { console, window: {} };
  sb.window = sb;
  return sb;
}

function load() {
  const sb = makeSandbox();
  loadScript('assets/js/schedule-import.js', sb);
  return sb.window.RHMScheduleImport;
}

// ── CSV parser ──────────────────────────────────────────────────────────────

test('parseCSV splits simple rows', () => {
  const imp = load();
  const rows = imp.parseCSV('a,b,c\n1,2,3');
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [['a','b','c'],['1','2','3']]);
});

test('parseCSV handles quoted fields with commas', () => {
  const imp = load();
  const rows = imp.parseCSV('"Team A, FC",Field 1\nAlpha,Beta');
  assert.equal(rows[0][0], 'Team A, FC');
  assert.equal(rows[0][1], 'Field 1');
});

test('parseCSV handles CRLF line endings', () => {
  const imp = load();
  const rows = imp.parseCSV('a,b\r\nc,d');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'c');
});

test('parseCSV handles escaped double-quotes inside quoted field', () => {
  const imp = load();
  const rows = imp.parseCSV('"He said ""hello""",next');
  assert.equal(rows[0][0], 'He said "hello"');
});

test('parseCSV skips blank rows', () => {
  const imp = load();
  const rows = imp.parseCSV('a,b\n\nc,d');
  assert.equal(rows.length, 2);
});

// ── Format detection ────────────────────────────────────────────────────────

test('detectFormat identifies flat format by headers', () => {
  const imp = load();
  const rows = [['Time','Field','Group','Team A','Team B','Round']];
  assert.equal(imp.detectFormat(rows), 'flat');
});

test('detectFormat identifies matrix format', () => {
  const imp = load();
  const rows = [['Field','10:00 AM','10:30 AM'],['Field 1','Alpha vs Beta','']];
  assert.equal(imp.detectFormat(rows), 'matrix');
});

test('detectFormat identifies matrix format with blank A1', () => {
  const imp = load();
  const rows = [['','12:00 PM','1:00 PM'],['Field 1','A vs B','']];
  assert.equal(imp.detectFormat(rows), 'matrix');
});

test('detectFormat returns null for unrecognised layout', () => {
  const imp = load();
  assert.equal(imp.detectFormat([['Foo','Bar','Baz']]), null);
});
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
node --test tests/schedule-import.test.js 2>&1 | grep -E "^# (pass|fail)|not ok"
```

Expected: all fail (module not yet created).

- [ ] **Step 3: Create `assets/js/schedule-import.js` with CSV parser and format detection**

```js
(function (window) {

  // ── CSV parser ─────────────────────────────────────────────────────────────

  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuote = false;
    var i = 0;
    var n = text.length;
    while (i < n) {
      var ch = text[i];
      if (inQuote) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuote = false;
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQuote = true;
        } else if (ch === ',') {
          row.push(field); field = '';
        } else if (ch === '\n') {
          row.push(field); field = '';
          rows.push(row); row = [];
        } else if (ch !== '\r') {
          field += ch;
        }
      }
      i++;
    }
    if (field || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c || '').trim(); }); });
  }

  // ── Format detection ───────────────────────────────────────────────────────

  function detectFormat(rows) {
    if (!rows || !rows.length) return null;
    var header = rows[0];
    var flat = header.join('\t').toLowerCase();
    if (flat.indexOf('time') >= 0 && flat.indexOf('field') >= 0 && flat.indexOf('team') >= 0) {
      return 'flat';
    }
    var a1 = String(header[0] || '').trim().toLowerCase();
    if (a1 === '' || a1 === 'field') {
      var hasTime = header.slice(1).some(function (cell) {
        return /^\d{1,2}:\d{2}\s*(am|pm)?$/i.test(String(cell || '').trim());
      });
      if (hasTime) return 'matrix';
    }
    return null;
  }

  window.RHMScheduleImport = {
    parseCSV: parseCSV,
    detectFormat: detectFormat
  };

})(window);
```

- [ ] **Step 4: Run CSV + detection tests — all 9 should pass**

```bash
node --test tests/schedule-import.test.js 2>&1 | grep -E "^# (pass|fail)"
```

Expected: `# pass 9` / `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add assets/js/schedule-import.js tests/schedule-import.test.js
git commit -m "feat: schedule-import.js — CSV parser and format detection"
```

---

## Task 3: schedule-import.js — parsers and fixture builder (TDD)

**Files:**
- Modify: `assets/js/schedule-import.js`
- Modify: `tests/schedule-import.test.js`

- [ ] **Step 1: Add failing tests for the parsers**

Append to `tests/schedule-import.test.js`:

```js
// ── Matrix parser ───────────────────────────────────────────────────────────

test('parseMatrix produces correct fixtures from a simple 2-field schedule', () => {
  const imp = load();
  const rows = [
    ['Field', '10:00 AM', '10:30 AM'],
    ['Field 1', 'Alpha vs Beta', 'Gamma vs Delta'],
    ['Field 2', 'Echo vs Foxtrot', '']
  ];
  const result = imp.parseMatrix(rows, 'group-stage');
  assert.equal(result.fixtures.filter(f => f.phase === 'group').length, 3);
  assert.equal(result.venues.length, 2);
  assert.ok(result.groups.length >= 1);
  const f0 = result.fixtures[0];
  assert.equal(f0.teamA, 'Alpha');
  assert.equal(f0.teamB, 'Beta');
  assert.equal(f0.startsAt, '10:00 AM');
  assert.equal(f0.venueId, 'venue-1');
});

test('parseMatrix assigns league groupName when no group indicators', () => {
  const imp = load();
  const rows = [
    ['', '10:00 AM'],
    ['Field 1', 'Alpha vs Beta']
  ];
  const result = imp.parseMatrix(rows, 'league');
  assert.equal(result.fixtures[0].groupName, 'League Stage');
  assert.equal(result.groups[0].name, 'League Stage');
});

test('parseMatrix assigns Group A groupName when tournamentFormat is group-stage and no group labels', () => {
  const imp = load();
  const rows = [
    ['', '10:00 AM'],
    ['Field 1', 'Alpha vs Beta']
  ];
  const result = imp.parseMatrix(rows, 'group-stage');
  assert.equal(result.fixtures[0].groupName, 'Group A');
  assert.equal(result.groups[0].name, 'Group A');
});

test('parseMatrix marks playoff cells correctly', () => {
  const imp = load();
  const rows = [
    ['Field', '12:00 PM'],
    ['Field 1', 'Final: Alpha vs Beta']
  ];
  const result = imp.parseMatrix(rows, 'group-stage');
  assert.equal(result.fixtures[0].phase, 'playoff');
});

test('parseMatrix slots are sorted by time', () => {
  const imp = load();
  const rows = [
    ['Field', '11:00 AM', '10:00 AM'],
    ['Field 1', 'C vs D', 'A vs B']
  ];
  const result = imp.parseMatrix(rows, 'group-stage');
  const sorted = result.fixtures.slice().sort((a, b) => a.slot - b.slot);
  assert.equal(sorted[0].teamA, 'A');
  assert.equal(sorted[1].teamA, 'C');
});

// ── Flat parser ─────────────────────────────────────────────────────────────

test('parseFlat produces correct fixtures from flat rows', () => {
  const imp = load();
  const rows = [
    ['Time', 'Field', 'Group', 'Team A', 'Team B', 'Round'],
    ['10:00 AM', 'Field 1', 'Group A', 'Alpha', 'Beta', 'Group Stage'],
    ['10:00 AM', 'Field 2', 'Group B', 'Gamma', 'Delta', 'Group A'],
    ['12:00 PM', 'Field 1', 'Playoffs', 'TBD', 'TBD', 'Final']
  ];
  const result = imp.parseFlat(rows);
  assert.equal(result.fixtures.length, 3);
  assert.equal(result.fixtures[2].phase, 'playoff');
  assert.equal(result.fixtures[0].groupName, 'Group A');
  assert.equal(result.fixtures[1].groupName, 'Group B');
  assert.equal(result.venues.length, 2);
});

test('parseFlat maps League and Pool round labels to group phase', () => {
  const imp = load();
  const rows = [
    ['Time', 'Field', 'Group', 'Team A', 'Team B', 'Round'],
    ['10:00 AM', 'Field 1', 'League Stage', 'A', 'B', 'League'],
    ['10:30 AM', 'Field 1', 'League Stage', 'C', 'D', 'Pool']
  ];
  const result = imp.parseFlat(rows);
  assert.equal(result.fixtures[0].phase, 'group');
  assert.equal(result.fixtures[1].phase, 'group');
  assert.equal(result.fixtures[0].groupName, 'League Stage');
});

// ── groupId consistency ──────────────────────────────────────────────────────

test('fixture groupId values are group-a, group-b etc matching group array ids', () => {
  const imp = load();
  const rows = [
    ['Time', 'Field', 'Group', 'Team A', 'Team B', 'Round'],
    ['10:00 AM', 'Field 1', 'Group A', 'Alpha', 'Beta', 'Group Stage'],
    ['10:00 AM', 'Field 2', 'Group B', 'Gamma', 'Delta', 'Group Stage']
  ];
  const result = imp.parseFlat(rows);
  const groupIds = result.groups.map(g => g.id);
  const fixtureGroupIds = [...new Set(result.fixtures.map(f => f.groupId))];
  fixtureGroupIds.forEach(id => {
    assert.ok(groupIds.includes(id), 'fixture groupId ' + id + ' not in groups array');
  });
});
```

- [ ] **Step 2: Run tests and confirm new tests fail**

```bash
node --test tests/schedule-import.test.js 2>&1 | grep -E "^# (pass|fail)"
```

Expected: 9 pass (earlier), new ones fail.

- [ ] **Step 3: Add time utilities and fixture builder to schedule-import.js**

In `assets/js/schedule-import.js`, add these helpers inside the IIFE, before the `window.RHMScheduleImport` export:

```js
  // ── Time utilities ─────────────────────────────────────────────────────────

  function parseTimeToMinutes(val) {
    val = String(val || '').trim();
    var m = val.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!m) return null;
    var h = parseInt(m[1], 10);
    var min = parseInt(m[2], 10);
    var mer = (m[3] || '').toUpperCase();
    if (mer === 'PM' && h !== 12) h += 12;
    if (mer === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  }

  function minutesToTime12(mins) {
    var h24 = Math.floor(mins / 60) % 24;
    var m = mins % 60;
    var h12 = h24 % 12 || 12;
    return h12 + ':' + String(m).padStart(2, '0') + ' ' + (h24 >= 12 ? 'PM' : 'AM');
  }

  var GL = ['a','b','c','d','e','f','g','h'];
  var PLAYOFF_RE = /final|semi|championship|winner\s+of/i;

  // ── Fixture builder (shared by both parsers) ────────────────────────────────
  //
  // games: [{fieldName, timeStr, teamA, teamB, isPlayoff, groupName}]
  // returns {fixtures, venues, groups, summary}

  function buildFixturesFromGames(games) {
    // Unique fields in order of first appearance
    var fieldNames = [];
    games.forEach(function (g) {
      if (g.fieldName && fieldNames.indexOf(g.fieldName) < 0) fieldNames.push(g.fieldName);
    });
    var venues = fieldNames.map(function (name, i) {
      return { id: 'venue-' + (i + 1), name: name };
    });

    // Unique group names (non-playoff only) in order of first appearance
    var groupNamesOrdered = [];
    games.forEach(function (g) {
      if (!g.isPlayoff && g.groupName && groupNamesOrdered.indexOf(g.groupName) < 0) {
        groupNamesOrdered.push(g.groupName);
      }
    });

    // Map groupName → groupId ('group-a', 'group-b', …)
    var groupIdMap = {};
    groupNamesOrdered.forEach(function (name, i) {
      groupIdMap[name] = 'group-' + (GL[i] || ('x' + i));
    });

    // Sort games by time then fieldName
    games = games.slice().sort(function (a, b) {
      var ta = parseTimeToMinutes(a.timeStr);
      var tb = parseTimeToMinutes(b.timeStr);
      ta = ta === null ? 9999 : ta;
      tb = tb === null ? 9999 : tb;
      if (ta !== tb) return ta - tb;
      return a.fieldName < b.fieldName ? -1 : 1;
    });

    // Assign slot indices by unique time
    var slotMap = {};
    var slotIdx = 0;
    games.forEach(function (g) {
      if (!(g.timeStr in slotMap)) slotMap[g.timeStr] = slotIdx++;
    });

    // Teams per group (for div.groups)
    var teamsByGroupId = {};
    games.forEach(function (g) {
      if (g.isPlayoff) return;
      var gid = groupIdMap[g.groupName];
      if (!teamsByGroupId[gid]) teamsByGroupId[gid] = [];
      [g.teamA, g.teamB].forEach(function (t) {
        if (t && teamsByGroupId[gid].indexOf(t) < 0) teamsByGroupId[gid].push(t);
      });
    });

    // Build fixtures
    var fixtures = games.map(function (g, i) {
      var vi = fieldNames.indexOf(g.fieldName);
      var venue = venues[vi] || venues[0] || { id: 'venue-1', name: g.fieldName };
      var groupId = g.isPlayoff ? null : groupIdMap[g.groupName];
      var timeMins = parseTimeToMinutes(g.timeStr);
      var startsAt = timeMins !== null ? minutesToTime12(timeMins) : (g.timeStr || '');
      return {
        id: 'import-' + i,
        divisionId: 'division-main',
        phase: g.isPlayoff ? 'playoff' : 'group',
        groupId: groupId,
        groupName: g.isPlayoff ? (g.groupName || null) : g.groupName,
        teamA: g.teamA,
        teamB: g.teamB,
        venueId: venue.id,
        venueName: venue.name,
        slot: slotMap[g.timeStr] !== undefined ? slotMap[g.timeStr] : 0,
        startsAt: startsAt,
        scoreA: null,
        scoreB: null,
        ref: '',
        status: 'scheduled'
      };
    });

    // Build groups array
    var groups = groupNamesOrdered.map(function (name, i) {
      var id = groupIdMap[name];
      return { id: id, name: name, teams: teamsByGroupId[id] || [] };
    });

    // Summary
    var uniqueSlotCount = Object.keys(slotMap).length;
    var sortedMins = Object.keys(slotMap)
      .map(parseTimeToMinutes)
      .filter(function (t) { return t !== null; })
      .sort(function (a, b) { return a - b; });
    var gameBlockMinutes = 30;
    if (sortedMins.length >= 2) {
      var total = 0;
      for (var j = 1; j < sortedMins.length; j++) total += sortedMins[j] - sortedMins[j - 1];
      gameBlockMinutes = Math.round(total / (sortedMins.length - 1));
    }

    return {
      fixtures: fixtures,
      venues: venues,
      groups: groups,
      summary: {
        totalFixtures: fixtures.length,
        totalSlots: uniqueSlotCount,
        gameBlockMinutes: gameBlockMinutes,
        note: 'Imported from file'
      }
    };
  }
```

- [ ] **Step 4: Add `parseMatrix` to schedule-import.js**

Add this function inside the IIFE, before the export:

```js
  function parseMatrix(rows, tournamentFormat) {
    if (!rows || rows.length < 2) return buildFixturesFromGames([]);
    var header = rows[0];
    var timeHeaders = header.slice(1).map(function (c) { return String(c || '').trim(); });
    var fieldRows = rows.slice(1);
    var games = [];

    fieldRows.forEach(function (row) {
      var fieldName = String(row[0] || '').trim();
      if (!fieldName) return;
      timeHeaders.forEach(function (timeStr, ci) {
        var cell = String(row[ci + 1] || '').trim();
        if (!cell) return;
        var vsIdx = cell.search(/ vs /i);
        if (vsIdx < 0) return;
        var teamA = cell.slice(0, vsIdx).trim();
        var teamB = cell.slice(vsIdx + 4).trim();
        var isPlayoff = PLAYOFF_RE.test(cell);
        var groupName = null;
        if (!isPlayoff) {
          var gm = cell.match(/\bgroup\s+([a-z])\b/i);
          if (gm) {
            groupName = 'Group ' + gm[1].toUpperCase();
          }
        }
        games.push({ fieldName: fieldName, timeStr: timeStr, teamA: teamA, teamB: teamB, isPlayoff: isPlayoff, groupName: groupName });
      });
    });

    // Auto-detect format from group labels found in cells
    var hasGroupLabels = games.some(function (g) { return !g.isPlayoff && g.groupName; });
    var detectedFormat = hasGroupLabels ? 'group-stage' : (tournamentFormat || 'league');
    var defaultGroupName = detectedFormat === 'league' ? 'League Stage' : 'Group A';

    games.forEach(function (g) {
      if (!g.isPlayoff && !g.groupName) g.groupName = defaultGroupName;
    });

    return buildFixturesFromGames(games);
  }
```

- [ ] **Step 5: Add `parseFlat` to schedule-import.js**

```js
  var GROUP_PHASE_RE = /^(group|league|pool)/i;

  function parseFlat(rows) {
    if (!rows || rows.length < 2) return buildFixturesFromGames([]);
    var header = rows[0].map(function (c) { return String(c || '').trim().toLowerCase(); });

    function col(keywords) {
      for (var ki = 0; ki < keywords.length; ki++) {
        var kw = keywords[ki];
        for (var i = 0; i < header.length; i++) {
          if (header[i].indexOf(kw) >= 0) return i;
        }
      }
      return -1;
    }

    var colTime  = col(['time']);
    var colField = col(['field']);
    var colGroup = col(['group']);
    var colTeamA = col(['team a']);
    var colTeamB = col(['team b']);
    var colRound = col(['round']);

    // fallback: first and second 'team' columns
    if (colTeamA < 0) colTeamA = col(['team']);
    if (colTeamB < 0) {
      for (var i = colTeamA + 1; i < header.length; i++) {
        if (header[i].indexOf('team') >= 0) { colTeamB = i; break; }
      }
    }

    var games = [];
    rows.slice(1).forEach(function (row) {
      if (!row.some(function (c) { return String(c || '').trim(); })) return;
      var timeStr  = colTime  >= 0 ? String(row[colTime]  || '').trim() : '';
      var fieldName= colField >= 0 ? String(row[colField] || '').trim() : 'Field 1';
      var groupName= colGroup >= 0 ? String(row[colGroup] || '').trim() : 'Group A';
      var teamA    = colTeamA >= 0 ? String(row[colTeamA] || '').trim() : '';
      var teamB    = colTeamB >= 0 ? String(row[colTeamB] || '').trim() : '';
      var round    = colRound >= 0 ? String(row[colRound] || '').trim() : '';

      var isPlayoff = PLAYOFF_RE.test(round) && !GROUP_PHASE_RE.test(round);
      games.push({
        fieldName: fieldName,
        timeStr: timeStr,
        teamA: teamA,
        teamB: teamB,
        isPlayoff: isPlayoff,
        groupName: isPlayoff ? null : groupName
      });
    });

    return buildFixturesFromGames(games);
  }
```

- [ ] **Step 6: Export new functions**

Update `window.RHMScheduleImport` export:

```js
  window.RHMScheduleImport = {
    parseCSV: parseCSV,
    detectFormat: detectFormat,
    parseMatrix: parseMatrix,
    parseFlat: parseFlat,
    buildFixturesFromGames: buildFixturesFromGames
  };
```

- [ ] **Step 7: Run all schedule-import tests — all 19 should pass**

```bash
node --test tests/schedule-import.test.js 2>&1 | grep -E "^# (pass|fail)"
```

Expected: `# pass 19` / `# fail 0`

- [ ] **Step 8: Run full suite**

```bash
node --test 2>&1 | grep -E "^# (pass|fail)"
```

Expected: `# pass 64` / `# fail 0`

- [ ] **Step 9: Commit**

```bash
git add assets/js/schedule-import.js tests/schedule-import.test.js
git commit -m "feat: schedule-import.js — matrix/flat parsers and fixture builder"
```

---

## Task 4: admin-events.html — localStorage-backed event management

**Files:**
- Modify: `admin-events.html`

- [ ] **Step 1: Add script tag for schedule-import.js is NOT needed here — add events-store.js load verification**

The page already loads `assets/js/events-store.js`. No new scripts needed for this task.

- [ ] **Step 2: Replace the hardcoded sample event card and broken Supabase-only flow**

Find and remove the hardcoded `<div class="event-card" id="ev-sample">` block (lines ~466–483 in the current file).

- [ ] **Step 3: Add a hidden edit-id field below the form submit button**

Inside the `<form class="form" onsubmit="addEvent(event)">`, add just before the `<button type="submit" class="btn-post">` line:

```html
          <input type="hidden" id="ev-editing-id" value="">
```

Also change the submit button label to be dynamic:

```html
          <button type="submit" class="btn-post" id="ev-submit-btn">Post Event</button>
```

- [ ] **Step 4: Add "Link Tournament" and "tournamentLinked" badge CSS**

In the `<style>` block, add:

```css
    .btn-link-tournament {
      font-size: 11px; font-weight: 600; letter-spacing: 0.08em;
      text-transform: uppercase; padding: 0.45rem 0.75rem;
      background: transparent; border: 1px solid var(--border2);
      color: var(--muted); cursor: pointer; transition: all 0.2s;
      font-family: 'DM Sans', sans-serif;
    }
    .btn-link-tournament:hover { border-color: var(--green); color: var(--green); }
    .btn-link-tournament.linked { border-color: var(--green); color: var(--green); background: rgba(45,184,75,0.1); }
    .badge-linked { background: rgba(45,184,75,0.15); color: var(--green); font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; padding: 0.2rem 0.55rem; display: inline-block; margin-left: 0.5rem; }
```

- [ ] **Step 5: Rewrite the inline `<script>` block**

Replace the entire `<script>` block (from `let eventCount = 0;` through `initAdminEvents().catch(...)`) with the following:

```js
    let editingId = null;

    const statusMap = {
      open: { label: 'Registration Open', cls: 'badge-open' },
      closed: { label: 'Registration Closed', cls: 'badge-closed' },
      soon: { label: 'Coming Soon', cls: 'badge-soon' },
    };

    const sportEmoji = {
      'flag-football': '🏈', basketball: '🏀', soccer: '⚽', volleyball: '🏐', other: '🎯'
    };

    const sportLabels = {
      'flag-football': 'Flag Football', basketball: 'Basketball', soccer: 'Soccer', volleyball: 'Volleyball', other: 'Other'
    };

    let registrationQuestions = [];

    const FALLBACK_EVENT = {
      id: 'seed-flag-football-1',
      name: 'RHM Flag Football Tournament',
      sport: 'flag-football',
      date: '2025-06-14',
      time: '10:00',
      location: 'Mississauga Sports Park',
      description: '',
      status: 'open',
      tournamentLinked: false,
      registration: { enabled: true, paymentRequired: false, paymentLink: '', questions: [] }
    };

    function eh(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function formatTime12(val) {
      if (!val) return '';
      const clean = String(val).slice(0, 5);
      try { return new Date('1970-01-01T' + clean).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
      catch (e) { return val; }
    }

    function formatDate(val) {
      if (!val) return '';
      try { return new Date(val + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); }
      catch (e) { return val; }
    }

    function defaultRegistrationQuestions() {
      return JSON.parse(JSON.stringify(window.RHMEventsStore.defaultRegistrationQuestions || []));
    }

    function toggleRegistrationBuilder() {
      document.getElementById('reg-builder-panel').classList.toggle('active', document.getElementById('reg-enabled').checked);
    }

    function renderRegistrationBuilder() {
      const builder = document.getElementById('reg-builder');
      builder.innerHTML = registrationQuestions.map((q, i) => `
        <div class="question-card" data-question-index="${i}">
          <div class="row-2">
            <div class="field"><label>Question Label</label>
              <input type="text" value="${eh(q.label)}" oninput="updateQ(${i},'label',this.value)" required></div>
            <div class="field"><label>Field Type</label>
              <select onchange="updateQ(${i},'type',this.value)">
                ${['text','email','phone','number','textarea','checkbox'].map(t => `<option value="${t}" ${q.type===t?'selected':''}>${t}</option>`).join('')}
              </select></div>
          </div>
          <div class="question-actions">
            <label><input type="checkbox" ${q.required!==false?'checked':''} onchange="updateQ(${i},'required',this.checked)"> Required</label>
            <button class="btn-remove" type="button" onclick="removeQ(${i})">Remove</button>
          </div>
        </div>`).join('');
    }

    function updateQ(i, key, val) {
      if (!registrationQuestions[i]) return;
      registrationQuestions[i][key] = key === 'required' ? (val === true) : val;
    }

    function addRegistrationQuestion() {
      registrationQuestions.push({ id: 'custom_' + Date.now(), label: 'New Question', type: 'text', required: false });
      renderRegistrationBuilder();
    }

    function removeQ(i) { registrationQuestions.splice(i, 1); renderRegistrationBuilder(); }

    function eventCardHTML(ev) {
      const status = statusMap[ev.status] || statusMap.soon;
      const emoji = sportEmoji[ev.sport] || '🎯';
      const sportLabel = sportLabels[ev.sport] || ev.sport;
      const timeLabel = formatTime12(ev.time);
      const dateLabel = formatDate(ev.date);
      const linked = ev.tournamentLinked === true;
      return `
        <div class="event-info">
          <div class="event-name">${eh(ev.name)}${linked ? '<span class="badge-linked">Linked</span>' : ''}</div>
          <div class="event-meta">
            ${dateLabel ? `<span>🗓 ${eh(dateLabel)}</span>` : ''}
            ${timeLabel ? `<span>🕙 ${eh(timeLabel)}</span>` : ''}
            ${ev.location ? `<span>📍 ${eh(ev.location)}</span>` : ''}
            <span>${emoji} ${eh(sportLabel)}</span>
          </div>
          <span class="badge ${status.cls}">${eh(status.label)}</span>
        </div>
        <div class="event-actions">
          <button class="btn-link-tournament${linked?' linked':''}" type="button" onclick="linkTournament('${eh(ev.id)}')">${linked ? 'Linked ✓' : 'Link Tournament'}</button>
          <button class="btn-edit" type="button" onclick="editEvent('${eh(ev.id)}')">Edit</button>
          <button class="btn-delete" type="button" onclick="deleteEvent('${eh(ev.id)}')">Delete</button>
        </div>`;
    }

    function renderEvents() {
      const events = window.RHMEventsStore.listLocalEvents();
      const list = document.getElementById('events-list');
      list.innerHTML = '';
      events.forEach(ev => {
        const card = document.createElement('div');
        card.className = 'event-card';
        card.id = 'evcard-' + ev.id;
        card.innerHTML = eventCardHTML(ev);
        list.appendChild(card);
      });
      document.getElementById('ev-count').textContent = events.length + ' event' + (events.length !== 1 ? 's' : '');
    }

    function addEvent(e) {
      e.preventDefault();
      const id = editingId || String(Date.now());
      const ev = {
        id,
        name: document.getElementById('ev-name').value.trim(),
        sport: document.getElementById('ev-sport').value,
        status: document.getElementById('ev-status').value,
        date: document.getElementById('ev-date').value,
        time: document.getElementById('ev-time').value,
        location: document.getElementById('ev-location').value.trim(),
        description: document.getElementById('ev-desc').value.trim(),
        tournamentLinked: editingId
          ? (window.RHMEventsStore.listLocalEvents().find(x => x.id === editingId) || {}).tournamentLinked === true
          : false,
        registration: {
          enabled: document.getElementById('reg-enabled').checked,
          paymentRequired: document.getElementById('reg-payment-required').checked,
          paymentLink: document.getElementById('reg-payment-link').value.trim(),
          questions: JSON.parse(JSON.stringify(registrationQuestions))
        }
      };
      window.RHMEventsStore.saveLocalEvent(ev);
      resetForm();
      renderEvents();
    }

    function resetForm() {
      editingId = null;
      document.getElementById('ev-editing-id').value = '';
      document.getElementById('ev-submit-btn').textContent = 'Post Event';
      document.querySelector('.panel-title').textContent = 'Create New Event';
      document.querySelector('.form').reset();
      document.getElementById('reg-enabled').checked = true;
      document.getElementById('reg-payment-required').checked = false;
      document.getElementById('reg-payment-link').value = '';
      registrationQuestions = defaultRegistrationQuestions();
      toggleRegistrationBuilder();
      renderRegistrationBuilder();
    }

    function editEvent(id) {
      const ev = window.RHMEventsStore.listLocalEvents().find(e => e.id === id);
      if (!ev) return;
      editingId = id;
      document.getElementById('ev-editing-id').value = id;
      document.getElementById('ev-name').value = ev.name || '';
      document.getElementById('ev-sport').value = ev.sport || 'flag-football';
      document.getElementById('ev-status').value = ev.status || 'open';
      document.getElementById('ev-date').value = ev.date || '';
      document.getElementById('ev-time').value = ev.time || '';
      document.getElementById('ev-location').value = ev.location || '';
      document.getElementById('ev-desc').value = ev.description || '';
      const reg = ev.registration || {};
      document.getElementById('reg-enabled').checked = reg.enabled !== false;
      document.getElementById('reg-payment-required').checked = reg.paymentRequired === true;
      document.getElementById('reg-payment-link').value = reg.paymentLink || '';
      registrationQuestions = JSON.parse(JSON.stringify(reg.questions || defaultRegistrationQuestions()));
      toggleRegistrationBuilder();
      renderRegistrationBuilder();
      document.getElementById('ev-submit-btn').textContent = 'Update Event';
      document.querySelector('.panel-title').textContent = 'Edit Event';
      document.querySelector('.form-panel').scrollIntoView({ behavior: 'smooth' });
    }

    function deleteEvent(id) {
      if (!confirm('Delete this event? This cannot be undone.')) return;
      window.RHMEventsStore.deleteLocalEvent(id);
      if (editingId === id) resetForm();
      renderEvents();
    }

    function linkTournament(id) {
      const events = window.RHMEventsStore.listLocalEvents();
      events.forEach(ev => {
        ev.tournamentLinked = (ev.id === id) ? !ev.tournamentLinked : false;
        window.RHMEventsStore.saveLocalEvent(ev);
      });
      renderEvents();
    }

    function initAdminEvents() {
      window.RHMAdminAuth.wireLogoutLinks();
      window.RHMAdminAuth.requireAdmin().then(admin => {
        if (!admin) return;
        const events = window.RHMEventsStore.listLocalEvents();
        if (!events.length) window.RHMEventsStore.saveLocalEvent(FALLBACK_EVENT);
        registrationQuestions = defaultRegistrationQuestions();
        renderRegistrationBuilder();
        renderEvents();
        // Load registrations from Supabase if available
        window.RHMEventsStore.listRegistrations().then(regs => {
          renderRegistrations(regs);
        }).catch(() => {});
      });
    }

    function renderRegistrations(registrations) {
      const list = document.getElementById('registrations-list');
      const count = document.getElementById('registration-count');
      count.textContent = registrations.length + ' submission' + (registrations.length !== 1 ? 's' : '');
      if (!registrations.length) { list.innerHTML = '<div class="event-card">No registrations yet.</div>'; return; }
      list.innerHTML = registrations.map(r => `
        <div class="registration-card">
          <div class="registration-card-head">
            <div><div class="registration-team">${eh(r.answers?.team_name?.value || r.event_name || 'Registration')}</div>
              <div class="event-meta"><span>${eh(r.event_name||'')}</span><span>${eh(r.payment_status||'pending')}</span></div></div>
            <div class="registration-time">${r.submitted_at ? eh(new Date(r.submitted_at).toLocaleString()) : ''}</div>
          </div>
          <div class="registration-answers">
            ${Object.values(r.answers||{}).map(a=>`<div><span class="answer-label">${eh(a.label||'')}</span><div class="answer-value">${eh(a.value||'')}</div></div>`).join('')}
          </div>
        </div>`).join('');
    }

    initAdminEvents();
```

- [ ] **Step 6: Manual smoke test**

Open `admin-events.html` in a browser (serve from project root via `npx serve .` or `python3 -m http.server`):
1. Page loads with the seeded Flag Football event in the list
2. Fill in form and click "Post Event" — new card appears, count updates
3. Click "Edit" on a card — form pre-fills, button says "Update Event"
4. Submit edit — card updates in place
5. Click "Delete" — confirm dialog → card removed
6. Click "Link Tournament" — card shows "Linked ✓" badge; clicking another event's Link button moves the badge

- [ ] **Step 7: Commit**

```bash
git add admin-events.html
git commit -m "feat: admin-events.html — localStorage-backed event management with Edit, Delete, Link Tournament"
```

---

## Task 5: events.html — dynamic rendering from localStorage

**Files:**
- Modify: `events.html`

- [ ] **Step 1: Remove the hardcoded event card**

In `events.html`, find the `<section class="events-section" id="events-list">` block. Remove the entire hardcoded `<div class="event-card reveal">…</div>` inside it, leaving just the empty section:

```html
  <section class="events-section" id="events-list">
  </section>
```

- [ ] **Step 2: Replace `hydratePublicEvents` and add localStorage rendering**

Find the `async function hydratePublicEvents()` function and the `publicEvents = [fallbackRegistrationEvent];` line.

Replace the entire second `<script>` block (starting at `let publicEvents = []`) with:

```js
    let publicEvents = [];
    let activeRegistrationEvent = null;

    const fallbackRegistrationEvent = window.RHMEventsStore.normalizeEvent({
      id: 'fallback-3v3',
      title: 'RHM 3v3 Tournament',
      sport: 'basketball',
      status: 'open',
      event_date: '2026-05-23',
      event_time: '12:00',
      location: '875 Dayhill Rd, Windsor, CT',
      description: 'Bring a squad of 3 to 5 players for a fast-paced RHM 3v3 tournament.',
      registration: {
        enabled: true, paymentRequired: true, paymentLink: '',
        questions: window.RHMEventsStore.defaultRegistrationQuestions
      }
    });

    function escapeEventText(v) {
      return String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function renderPublicEvent(event) {
      const date = event.date ? new Date(event.date + 'T00:00:00') : null;
      const day = date ? String(date.getDate()).padStart(2, '0') : 'TBA';
      const month = date ? date.toLocaleDateString('en-US', { month: 'short' }) : '';
      const liveBtn = event.tournamentLinked
        ? `<a href="tournament-live.html" class="btn-primary" style="background:var(--green);border-color:var(--green);color:#000;">VIEW LIVE RESULTS →</a>`
        : '';
      const regBtn = (event.registration && event.registration.enabled)
        ? `<a href="#registration-modal" class="btn-primary" data-register-event data-event-id="${escapeEventText(event.id)}">Register Now →</a>`
        : '';
      return `
        <div class="event-card reveal visible">
          <div class="event-date-block"><div>
            <div class="event-day">${escapeEventText(day)}</div>
            <div class="event-month">${escapeEventText(month)}</div>
          </div></div>
          <div class="event-details">
            <div>
              <div class="event-badge">${escapeEventText(event.statusLabel)}</div>
              <h2 class="event-title">${escapeEventText(event.title)}</h2>
              <div class="event-meta">
                ${event.location ? `<span class="event-meta-item">📍 ${escapeEventText(event.location)}</span>` : ''}
                ${event.timeLabel ? `<span class="event-meta-item">🕙 ${escapeEventText(event.timeLabel)}</span>` : ''}
                ${event.dateLabel ? `<span class="event-meta-item">🗓 ${escapeEventText(event.dateLabel)}</span>` : ''}
              </div>
              <p class="event-description">${escapeEventText(event.description || event.sportLabel)}</p>
            </div>
            <div class="event-ctas">${regBtn}${liveBtn}</div>
          </div>
        </div>`;
    }

    function renderLocalEvents() {
      const raw = window.RHMEventsStore.listLocalEvents();
      const list = document.getElementById('events-list');
      if (!raw.length) {
        list.innerHTML = '<div style="padding:3rem 0;text-align:center;color:var(--muted);font-size:1rem;">No upcoming events. Check back soon.</div>';
        return;
      }
      const normalized = raw.map(ev => window.RHMEventsStore.normalizeEvent(ev));
      publicEvents = normalized;
      list.innerHTML = normalized.map(renderPublicEvent).join('');
    }

    async function hydratePublicEvents() {
      if (!window.RHM_SUPABASE_READY) return;
      const events = await window.RHMEventsStore.listPublishedEvents();
      if (!events.length) return;
      publicEvents = events;
      document.getElementById('events-list').innerHTML = events.map(renderPublicEvent).join('');
    }

    // Render local events first (instant), then optionally hydrate from Supabase
    renderLocalEvents();
    hydratePublicEvents().catch(err => console.error(err));

    // … rest of registration modal handlers (keep unchanged — questionInput, renderRegistrationFields, etc.)
```

Keep all the existing registration modal handler functions (`questionInput`, `renderRegistrationFields`, `updateRegistrationSummary`, `openRegistration`, `closeRegistration`, `registrationPayload`, `validateRegistration`, `saveRegistration`, `paymentHref`, `handleRegistrationSubmit`) **unchanged**.

- [ ] **Step 3: Manual smoke test**

Open `events.html` in a browser:
1. With `rhm_events` populated (from admin-events.html), event cards render dynamically
2. An event with `tournamentLinked: true` shows a green "VIEW LIVE RESULTS →" button
3. An event with `registration.enabled: true` shows a "Register Now →" button
4. With localStorage cleared, page shows "No upcoming events. Check back soon."

- [ ] **Step 4: Commit**

```bash
git add events.html
git commit -m "feat: events.html — dynamic rendering from rhm_events localStorage"
```

---

## Task 6: tournament-live.html — linked event banner

**Files:**
- Modify: `tournament-live.html`

- [ ] **Step 1: Add CSS for the event banner**

In the `<style>` block, add after the `.notice` rule:

```css
    /* ── EVENT BANNER ── */
    .event-banner {
      background: var(--surface); border-bottom: 1px solid var(--border);
      padding: 1.25rem 2rem;
    }
    .event-banner-meta {
      font-size: 11px; font-weight: 600; letter-spacing: 0.18em;
      text-transform: uppercase; color: var(--green); margin-bottom: 0.3rem;
    }
    .event-banner-name {
      font-family: 'Bebas Neue', sans-serif;
      font-size: 1.75rem; letter-spacing: 0.06em; color: var(--white); line-height: 1;
    }
```

- [ ] **Step 2: Add `getLinkedEventBanner()` function**

Add this function near the top of the inline `<script>` block, before `render()`:

```js
function getLinkedEventBanner() {
  try {
    var events = JSON.parse(localStorage.getItem('rhm_events') || '[]');
    var ev = null;
    for (var i = 0; i < events.length; i++) {
      if (events[i].tournamentLinked === true) { ev = events[i]; break; }
    }
    if (!ev) return '';
    var parts = [];
    if (ev.sport) parts.push(String(ev.sport).replace(/-/g,' ').toUpperCase());
    if (ev.date) {
      try {
        var d = new Date(ev.date + 'T00:00:00');
        parts.push(d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }).toUpperCase());
      } catch(e) { parts.push(ev.date); }
    }
    if (ev.location) parts.push(eh(ev.location).toUpperCase());
    return '<div class="event-banner"><div class="event-banner-meta">' +
      parts.map(function(p){ return eh(p); }).join(' &nbsp;·&nbsp; ') +
      '</div><div class="event-banner-name">' + eh(ev.name || '') + '</div></div>';
  } catch (e) {
    return '';
  }
}
```

- [ ] **Step 3: Inject the banner into `render()`**

In the `render()` function, find the line:

```js
  let html = '';
```

Change it to:

```js
  let html = getLinkedEventBanner();
```

- [ ] **Step 4: Manual smoke test**

1. In admin-events.html, link a tournament to an event
2. Open tournament-live.html — banner appears at top showing sport, date, location and event name
3. Unlink — banner disappears on next refresh cycle
4. With no linked event — no banner, existing hero shows as normal

- [ ] **Step 5: Commit**

```bash
git add tournament-live.html
git commit -m "feat: tournament-live.html — linked event banner from rhm_events localStorage"
```

---

## Task 7: admin-bracket.html — Tournament Format selector

**Files:**
- Modify: `admin-bracket.html`

- [ ] **Step 1: Add Tournament Format select to the Settings card**

In `admin-bracket.html`, find the `<div class="f-row">` containing the `t-ties` select (around line 400). Add this new row **after** the `t-ties` row and before the closing `</div>` of the 2-col grid it's in:

Actually, add it as its own `f-row` directly after the win/draw/loss/ties grid. Find the line:

```html
          <div class="f-row" style="margin-bottom:0;">
            <label class="f-label">Venues</label>
```

Insert **before** that row:

```html
          <div class="f-row">
            <label class="f-label" for="t-format">Tournament Format</label>
            <select class="f-select" id="t-format">
              <option value="group-stage">Group Stage</option>
              <option value="league">League Stage</option>
            </select>
          </div>
```

- [ ] **Step 2: Read and apply the format field in `readSettings()` and `applySettings()`**

In `readSettings()`, add after `tiesAllowed`:

```js
    tournamentFormat: document.getElementById('t-format').value || 'group-stage',
```

In `applySettings()`, add after the `t-ties` line:

```js
  document.getElementById('t-format').value = settings.tournamentFormat || 'group-stage';
```

- [ ] **Step 3: Manual verification**

Open admin-bracket.html → Setup tab. Confirm "Tournament Format" select appears with two options. Saving settings preserves the selection across page reload.

- [ ] **Step 4: Commit**

```bash
git add admin-bracket.html
git commit -m "feat: admin-bracket.html — Tournament Format selector (Group Stage / League Stage)"
```

---

## Task 8: admin-bracket.html — Import section UI + XLSX + orchestration

**Files:**
- Modify: `admin-bracket.html`

- [ ] **Step 1: Add `schedule-import.js` script tag**

In `admin-bracket.html`, in the `<head>` or just before the closing `</body>` but **before** the existing inline `<script>`, add:

```html
<script src="assets/js/schedule-import.js"></script>
```

- [ ] **Step 2: Add Import section CSS**

In the `<style>` block, add:

```css
    /* ── IMPORT SECTION ── */
    .import-section { margin-top: 1.5rem; }
    .import-divider {
      display: flex; align-items: center; gap: 1rem;
      margin: 2rem 0 1.5rem; color: var(--muted); font-size: 11px;
      font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
    }
    .import-divider::before, .import-divider::after {
      content: ''; flex: 1; height: 1px; background: var(--border);
    }
    .import-file-row {
      display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.75rem;
    }
    .import-file-input {
      background: #0d0d0d; border: 1px solid var(--border2); color: var(--white);
      font-family: 'DM Sans', sans-serif; font-size: 13px; padding: 0.55rem 0.75rem;
      flex: 1; min-width: 180px;
    }
    .import-file-input::file-selector-button {
      background: var(--surface2); border: none; border-right: 1px solid var(--border2);
      color: var(--muted); font-family: 'DM Sans', sans-serif; font-size: 11px;
      font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
      padding: 0.55rem 0.85rem; cursor: pointer; margin-right: 0.75rem;
    }
    .import-help {
      font-size: 12px; color: var(--muted); margin-bottom: 0.75rem;
    }
    .import-help a {
      color: var(--green); text-decoration: none; cursor: pointer;
    }
    .import-help a:hover { text-decoration: underline; }
    .import-banner {
      padding: 0.75rem 1rem; font-size: 13px; margin-top: 0.75rem; display: none;
    }
    .import-banner.success { background: rgba(45,184,75,0.1); border: 1px solid rgba(45,184,75,0.4); color: var(--green); display: block; }
    .import-banner.error   { background: rgba(224,85,85,0.1);  border: 1px solid rgba(224,85,85,0.4);  color: #e05555; display: block; }
```

- [ ] **Step 3: Add Import section HTML to the Setup panel**

In `admin-bracket.html`, find the Generate Schedule button block:

```html
    <div style="text-align:center;padding-top:0.5rem;">
      <button class="btn-primary" ...>Generate Schedule</button>
    </div>
```

Add this block immediately **after** it (still inside `<div class="panel active" id="panel-setup">`):

```html
    <div class="import-section">
      <div class="import-divider">OR IMPORT EXISTING SCHEDULE</div>
      <div class="s-card">
        <div class="s-title">Import Schedule</div>
        <div class="import-help">
          Export your Google Sheet as CSV or Excel, then import here.
          <a onclick="downloadImportTemplate()">Download Template</a>
        </div>
        <div class="import-file-row">
          <input class="import-file-input" type="file" id="import-file-input" accept=".csv,.xlsx">
          <button class="btn-primary" onclick="importSchedule()">IMPORT</button>
        </div>
        <div class="import-banner" id="import-banner"></div>
      </div>
    </div>
```

- [ ] **Step 4: Add XLSX lazy loader utility**

Inside the inline `<script>` block in admin-bracket.html, add this helper:

```js
function loadSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js';
    s.onload = function() { resolve(window.XLSX); };
    s.onerror = function() { reject(new Error('Failed to load SheetJS')); };
    document.head.appendChild(s);
  });
}
```

- [ ] **Step 5: Add `importSchedule()` function**

Add this function to the inline `<script>` block:

```js
async function importSchedule() {
  const banner = document.getElementById('import-banner');
  banner.className = 'import-banner';
  banner.textContent = '';

  const fileInput = document.getElementById('import-file-input');
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    banner.textContent = 'Please choose a CSV or Excel file first.';
    banner.className = 'import-banner error';
    return;
  }

  let rows;
  try {
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      const XLSX = await loadSheetJS();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    } else {
      const text = await file.text();
      rows = window.RHMScheduleImport.parseCSV(text);
    }
  } catch (err) {
    banner.textContent = 'Could not read file: ' + (err.message || err);
    banner.className = 'import-banner error';
    return;
  }

  const format = window.RHMScheduleImport.detectFormat(rows);
  if (!format) {
    banner.textContent = 'Unrecognised file format. Download the template to see the expected layout.';
    banner.className = 'import-banner error';
    return;
  }

  const div = activeDivision();
  const tournamentFormat = div.settings.tournamentFormat || 'group-stage';

  let result;
  try {
    result = format === 'matrix'
      ? window.RHMScheduleImport.parseMatrix(rows, tournamentFormat)
      : window.RHMScheduleImport.parseFlat(rows);
  } catch (err) {
    banner.textContent = 'Parse error: ' + (err.message || err);
    banner.className = 'import-banner error';
    return;
  }

  if (!result.fixtures.length) {
    banner.textContent = 'No games could be parsed. Check that the file matches the expected format.';
    banner.className = 'import-banner error';
    return;
  }

  // Write results into S
  div.venues = result.venues;
  div.groups = result.groups;
  div.fixtures = result.fixtures;
  div.scheduleSummary = result.summary;
  div.settings.numGroups = result.groups.length;
  div.settings.numFields = result.venues.length;
  div.settings.tournamentFormat = tournamentFormat;

  syncLegacyTournamentFields();
  save();

  const gameCount = result.fixtures.filter(function(f){ return f.phase === 'group'; }).length;
  banner.textContent = 'Schedule imported successfully — ' + gameCount + ' games loaded';
  banner.className = 'import-banner success';

  switchTab('schedule');
}
```

- [ ] **Step 6: Add `downloadImportTemplate()` function**

```js
function downloadImportTemplate() {
  const comment = '# RHM Schedule Import Template\n# Columns: Time | Field | Group | Team A | Team B | Round\n# Round values: Group Stage, Group A, League Stage, League, Pool -> group phase\n#               Final, Semi, Championship -> playoff phase\n';
  const header = 'Time,Field,Group,Team A,Team B,Round\n';
  const ex1 = '10:00 AM,Field 1,Group A,Aqsa Avengers,Strap Kingz,Group Stage\n';
  const ex2 = '10:00 AM,Field 2,Group B,Icemen,EH Warriors,Group Stage\n';
  const blob = new Blob([comment, header, ex1, ex2], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rhm-schedule-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 7: Manual smoke test — flat CSV**

1. Open admin-bracket.html, go to Setup tab
2. Click "Download Template" — `rhm-schedule-template.csv` downloads
3. Edit the CSV to add a few real teams and games
4. Choose the file, click IMPORT
5. Green banner appears, Schedule tab opens with games in the grid
6. Standings tab shows the correct group tables with imported team names

- [ ] **Step 8: Manual smoke test — matrix CSV**

Create a CSV like:
```
Field,10:00 AM,10:30 AM
Field 1,Alpha vs Beta,Gamma vs Delta
Field 2,Echo vs Foxtrot,
```
Import it — verify Schedule tab renders 3 games across 2 fields and 2 slots.

- [ ] **Step 9: Commit**

```bash
git add admin-bracket.html
git commit -m "feat: admin-bracket.html — Import Schedule section with CSV/XLSX support and Download Template"
```

---

## Task 9: Verify dynamic groupName rendering in standings

**Files:**
- Review: `admin-bracket.html` (renderBracketTab)
- Review: `tournament-live.html` (renderStandingsPanel)

These use `computeStandings` from `tournament-standings.js`, which returns `{ groupId, groupName, rows }` per group where `groupName = group.name`. Since import sets `div.groups[i].name` to the actual label, and `competitionGroups()` preserves `group.name`, the standings tables already render the correct label.

- [ ] **Step 1: Verify `competitionGroups()` preserves imported group names**

In `admin-bracket.html`, find `competitionGroups()` (around line 849). Confirm this line uses `group.name`:

```js
    name: group.name || 'Group ' + GL[index],
```

The `|| 'Group ' + GL[index]` fallback only fires if `group.name` is falsy — imported groups always have a name, so this is safe.

- [ ] **Step 2: Confirm `renderBracketTab` uses `gs.groupName` not a hardcoded label**

In `admin-bracket.html`, find `renderBracketTab()`. Confirm the standings table header reads:

```js
      `<div class="stg-name">${eh(gs.groupName)}</div>`
```

If it instead says `'Group ' + something`, update it to `eh(gs.groupName)`.

- [ ] **Step 3: Confirm `renderStandingsPanel` in tournament-live.html uses `gs.groupName`**

In `tournament-live.html`, find `renderStandingsPanel()`. Confirm:

```js
      `<div class="stg-name">${eh(gs.groupName)}</div>`
```

- [ ] **Step 4: End-to-end test with league import**

1. Import a flat CSV where Group column is "League Stage" for all rows
2. Go to Bracket & Standings tab — one table, labelled "League Stage"
3. Go to tournament-live.html — Standings tab shows one table labelled "League Stage"

- [ ] **Step 5: End-to-end test with multi-group import**

1. Import a flat CSV with Group A and Group B rows
2. Bracket & Standings shows two tables: "Group A" and "Group B"
3. tournament-live.html Standings shows the same

- [ ] **Step 6: Commit (if any fixes were needed)**

```bash
git add admin-bracket.html tournament-live.html
git commit -m "fix: ensure standings labels render from groupName not hardcoded strings"
```

---

## Task 10: Final regression

- [ ] **Step 1: Run full test suite**

```bash
node --test 2>&1 | grep -E "^# (pass|fail)"
```

Expected: `# pass 64` / `# fail 0`

- [ ] **Step 2: Verify existing bracket tool still works end-to-end**

Open admin-bracket.html:
1. Setup tab — fill teams, set groups, click Generate Schedule → Schedule tab renders
2. Enter scores → Standings and Bracket update
3. Publish / Unpublish buttons still work
4. Reset clears everything
5. tournament-live.html shows published tournament data

- [ ] **Step 3: Verify events roundtrip**

1. admin-events.html — post an event, link it to tournament
2. events.html — event card appears, "VIEW LIVE RESULTS →" button visible
3. tournament-live.html — event banner shows at top

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: final integration — schedule import + events system complete"
```
