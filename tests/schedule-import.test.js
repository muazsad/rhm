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
  const sb = { console, window: {}, JSON };
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

test('detectFormat identifies matrix format with "Court" label', () => {
  const imp = load();
  const rows = [['Court','12:00 PM','12:30 PM'],['Court 1','Alpha vs Beta','']];
  assert.equal(imp.detectFormat(rows), 'matrix');
});

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

test('parseMatrix flags a non-empty cell that does not split into two teams', () => {
  const imp = load();
  const rows = [
    ['Field', '10:00 AM', '10:30 AM'],
    ['Field 1', 'Alpha vs Beta', 'Gamma Delta only one side']
  ];
  const result = imp.parseMatrix(rows, 'league');
  assert.equal(result.fixtures.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].court, 'Field 1');
  assert.equal(result.errors[0].timeSlot, '10:30 AM');
  assert.match(result.errors[0].message, /vs/i);
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

test('parseFlat flags a row missing one of the two team names', () => {
  const imp = load();
  const rows = [
    ['Time', 'Field', 'Group', 'Team A', 'Team B', 'Round'],
    ['10:00 AM', 'Field 1', 'Group A', 'Alpha', '', 'Group Stage']
  ];
  const result = imp.parseFlat(rows);
  assert.equal(result.fixtures.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /team/i);
});

// ── Dimension validation ────────────────────────────────────────────────────

test('checkDimensions flags a data row with fewer columns than the header', () => {
  const imp = load();
  const rows = [
    ['Court', '12:00 PM', '12:30 PM'],
    ['Court 1', 'Alpha vs Beta']
  ];
  const issues = imp.checkDimensions(rows);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rowNumber, 2);
  assert.equal(issues[0].expected, 3);
  assert.equal(issues[0].actual, 2);
});

test('checkDimensions returns empty array when all rows match header width', () => {
  const imp = load();
  const rows = [
    ['Court', '12:00 PM'],
    ['Court 1', 'Alpha vs Beta'],
    ['Court 2', 'Gamma vs Delta']
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(imp.checkDimensions(rows))), []);
});

// ── Roster validation ───────────────────────────────────────────────────────

test('findUnknownTeams flags team names absent from the known roster', () => {
  const imp = load();
  const fixtures = [
    { teamA: 'Alpha', teamB: 'Beta' },
    { teamA: 'Zeta', teamB: 'Alpha' }
  ];
  const unknown = imp.findUnknownTeams(fixtures, ['Alpha', 'Beta']);
  assert.deepEqual(JSON.parse(JSON.stringify(unknown)), ['Zeta']);
});

test('findUnknownTeams returns empty array when roster is empty', () => {
  const imp = load();
  const fixtures = [{ teamA: 'Alpha', teamB: 'Beta' }];
  assert.deepEqual(JSON.parse(JSON.stringify(imp.findUnknownTeams(fixtures, []))), []);
});
