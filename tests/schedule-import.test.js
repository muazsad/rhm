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
