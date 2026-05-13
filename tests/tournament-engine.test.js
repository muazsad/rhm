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

function sampleGroups() {
  return [
    { name: 'Group A', teams: ['Aqsa Avengers', 'EH Warriors', 'Halal Marys'] },
    { name: 'Group B', teams: ['Intifada Black Ops', 'Strap Kings', 'Rafey Khan'] }
  ];
}

test('round robin schedule omits unused fields when requested fields exceed possible concurrency', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateSchedule({
    settings: {
      numFields: 3,
      gameDuration: 25,
      breakBetween: 5,
      startTime: '13:00',
      playoffFormat: 'top2'
    },
    groups: sampleGroups()
  });

  assert.equal(result.summary.requestedFields, 3);
  assert.equal(result.summary.activeFields, 2);
  assert.equal(result.schedule.length, 6);
  assert.deepEqual([...new Set(result.schedule.map(game => game.field))], [0, 1]);
  assert.equal(result.summary.note, '3 fields requested; 2 can be used without teams playing twice in the same slot.');
});

test('round robin schedule keeps teams from double-booking in a time slot', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateSchedule({
    settings: {
      numFields: 4,
      gameDuration: 20,
      breakBetween: 5,
      startTime: '10:00',
      playoffFormat: 'top2'
    },
    groups: [
      { name: 'Group A', teams: ['A1', 'A2', 'A3', 'A4'] },
      { name: 'Group B', teams: ['B1', 'B2', 'B3', 'B4'] },
      { name: 'Group C', teams: ['C1', 'C2', 'C3', 'C4'] }
    ]
  });

  const slots = [...new Set(result.schedule.map(game => game.slot))];
  slots.forEach(slot => {
    const teams = result.schedule
      .filter(game => game.slot === slot)
      .flatMap(game => [game.tA, game.tB]);
    assert.equal(teams.length, new Set(teams).size);
  });
});
