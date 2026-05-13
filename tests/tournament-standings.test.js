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

function plain(value) {
  return JSON.parse(JSON.stringify(value));
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

  assert.deepEqual(plain(standings[0].rows.map(row => row.team)), ['A', 'C', 'B']);
  assert.equal(standings[0].rows[0].diff, 7);
});

test('computeStandings uses head to head after points wins and differential are tied', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-standings.js', sandbox);

  const standings = sandbox.window.RHMTournamentStandings.computeStandings({
    groups: [{ id: 'group-a', name: 'Group A', teams: ['A', 'B', 'C', 'D'] }],
    fixtures: [
      { phase: 'group', groupId: 'group-a', teamA: 'A', teamB: 'B', scoreA: 1, scoreB: 0, status: 'final' },
      { phase: 'group', groupId: 'group-a', teamA: 'A', teamB: 'C', scoreA: 0, scoreB: 1, status: 'final' },
      { phase: 'group', groupId: 'group-a', teamA: 'B', teamB: 'D', scoreA: 3, scoreB: 2, status: 'final' },
      { phase: 'group', groupId: 'group-a', teamA: 'C', teamB: 'D', scoreA: 5, scoreB: 0, status: 'final' }
    ],
    rules: { winPoints: 3, drawPoints: 1, lossPoints: 0, tiesAllowed: false }
  });

  assert.deepEqual(plain(standings[0].rows.map(row => row.team)), ['C', 'A', 'B', 'D']);
  assert.deepEqual(plain(standings[0].rows.filter(row => row.team === 'A' || row.team === 'B').map(row => row.diff)), [0, 0]);
});

test('computeStandings falls back deterministically for multi-team head to head cycles', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-standings.js', sandbox);

  function rankTeams(teams) {
    const standings = sandbox.window.RHMTournamentStandings.computeStandings({
      groups: [{ id: 'group-a', name: 'Group A', teams }],
      fixtures: [
        { phase: 'group', groupId: 'group-a', teamA: 'A', teamB: 'B', scoreA: 1, scoreB: 0, status: 'final' },
        { phase: 'group', groupId: 'group-a', teamA: 'B', teamB: 'C', scoreA: 1, scoreB: 0, status: 'final' },
        { phase: 'group', groupId: 'group-a', teamA: 'C', teamB: 'A', scoreA: 1, scoreB: 0, status: 'final' }
      ],
      rules: { winPoints: 3, drawPoints: 1, lossPoints: 0, tiesAllowed: false }
    });

    return plain(standings[0].rows.map(row => row.team));
  }

  assert.deepEqual(rankTeams(['A', 'B', 'C']), ['A', 'B', 'C']);
  assert.deepEqual(rankTeams(['A', 'C', 'B']), ['A', 'B', 'C']);
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

  assert.deepEqual(plain(seeds.map(seed => seed.team)), ['B', 'A']);
});

test('duplicate-team seed overrides keep projected seed teams unique', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-standings.js', sandbox);

  const standings = [{
    groupId: 'group-a',
    groupName: 'Group A',
    rows: [
      { team: 'A', rank: 1 },
      { team: 'B', rank: 2 },
      { team: 'C', rank: 3 }
    ]
  }];

  const seeds = sandbox.window.RHMTournamentStandings.projectSeeds({
    standings,
    advancePerGroup: 3,
    seedOverrides: [
      { groupId: 'group-a', seed: 1, team: 'B' },
      { groupId: 'group-a', seed: 2, team: 'B' }
    ]
  });

  assert.deepEqual(plain(seeds.map(seed => seed.team)), ['B', 'A', 'C']);
});

test('projectSeeds can wait for the first group result before projecting teams', () => {
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

  const pendingSeeds = sandbox.window.RHMTournamentStandings.projectSeeds({
    standings,
    advancePerGroup: 1,
    requireGroupResult: true,
    fixtures: [
      { phase: 'group', teamA: 'A', teamB: 'B', scoreA: null, scoreB: null }
    ]
  });

  const projectedSeeds = sandbox.window.RHMTournamentStandings.projectSeeds({
    standings,
    advancePerGroup: 1,
    requireGroupResult: true,
    fixtures: [
      { phase: 'group', teamA: 'A', teamB: 'B', scoreA: 7, scoreB: 0 }
    ]
  });

  assert.deepEqual(plain(pendingSeeds), []);
  assert.deepEqual(plain(projectedSeeds.map(seed => seed.team)), ['A']);
});
