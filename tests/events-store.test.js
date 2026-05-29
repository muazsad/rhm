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
