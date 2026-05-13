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
  const store = new Map();
  const sandbox = {
    console,
    window: {},
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      }
    }
  };
  sandbox.window = sandbox;
  return sandbox;
}

test('Supabase config marks placeholder credentials as not ready', () => {
  const sandbox = makeSandbox();
  sandbox.window.RHM_SUPABASE_CONFIG_OVERRIDE = {
    url: 'https://your-project-ref.supabase.co',
    anonKey: 'your-supabase-anon-key'
  };

  loadBrowserScript('assets/js/supabase-config.js', sandbox);

  assert.equal(sandbox.window.RHM_SUPABASE_READY, false);
});

test('Supabase config marks real credentials as ready', () => {
  const sandbox = makeSandbox();

  loadBrowserScript('assets/js/supabase-config.js', sandbox);

  assert.equal(sandbox.window.RHM_SUPABASE_READY, true);
});

test('tournament store falls back to localStorage when Supabase is not configured', async () => {
  const sandbox = makeSandbox();
  sandbox.window.RHM_SUPABASE_CONFIG_OVERRIDE = {
    url: 'https://your-project-ref.supabase.co',
    anonKey: 'your-supabase-anon-key'
  };
  const state = {
    settings: { name: 'Summer Classic' },
    groups: [{ name: 'Group A', teams: ['A', 'B'] }],
    schedule: [],
    playoffs: []
  };

  loadBrowserScript('assets/js/supabase-config.js', sandbox);
  loadBrowserScript('assets/js/tournament-store.js', sandbox);

  await sandbox.window.RHMTournamentStore.saveTournamentState(state);
  assert.equal(
    JSON.stringify(await sandbox.window.RHMTournamentStore.loadTournamentState()),
    JSON.stringify(state)
  );
});

test('event store normalizes records for public rendering', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/events-store.js', sandbox);

  const event = sandbox.window.RHMEventsStore.normalizeEvent({
    id: 'event-1',
    title: 'Flag Football',
    sport: 'flag-football',
    status: 'open',
    event_date: '2026-06-14',
    event_time: '10:00:00',
    location: 'Community Field',
    description: 'Tournament day'
  });

  assert.equal(event.title, 'Flag Football');
  assert.equal(event.statusLabel, 'Registration Open');
  assert.equal(event.sportLabel, 'Flag Football');
  assert.equal(event.dateLabel, 'June 14, 2026');
  assert.equal(event.timeLabel, '10:00 AM');
});
