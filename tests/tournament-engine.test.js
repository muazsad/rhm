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

function playoffSideKey(side) {
  if (!side) return '';
  if (side.sourceFixtureId) return `winner:${side.sourceFixtureId}`;
  return `seed:${side.groupId}:${side.seed}`;
}

function assertPlayablePlayoffFixtures(fixtures) {
  const playoffs = fixtures.filter(fixture => fixture.phase === 'playoff');
  assert.ok(playoffs.length > 0);
  playoffs.forEach(fixture => {
    assert.ok(fixture.seedA, `${fixture.id} is missing seedA`);
    assert.ok(fixture.seedB, `${fixture.id} is missing seedB`);
    assert.notEqual(playoffSideKey(fixture.seedA), playoffSideKey(fixture.seedB), `${fixture.id} is a self-match`);
  });
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

test('generateDivisionSchedule avoids self matches and one-sided playoff fixtures for three groups top1', () => {
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
      { id: 'group-b', name: 'Group B', teams: ['B1', 'B2'] },
      { id: 'group-c', name: 'Group C', teams: ['C1', 'C2'] }
    ],
    blockedWindows: []
  });

  assertPlayablePlayoffFixtures(result.fixtures);
});

test('generateDivisionSchedule avoids self matches and one-sided playoff fixtures for three groups top2', () => {
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
      playoffFormat: 'top2'
    },
    venues: [
      { id: 'field-1', name: 'Field 1' },
      { id: 'field-2', name: 'Field 2' }
    ],
    groups: [
      { id: 'group-a', name: 'Group A', teams: ['A1', 'A2'] },
      { id: 'group-b', name: 'Group B', teams: ['B1', 'B2'] },
      { id: 'group-c', name: 'Group C', teams: ['C1', 'C2'] }
    ],
    blockedWindows: []
  });

  assertPlayablePlayoffFixtures(result.fixtures);
});

test('generateDivisionSchedule packs two five-team groups across three fields without three straight games', () => {
  const sandbox = makeSandbox();
  loadBrowserScript('assets/js/tournament-engine.js', sandbox);

  const result = sandbox.window.RHMTournamentEngine.generateDivisionSchedule({
    divisionId: 'rhm',
    settings: {
      startTime: '12:30',
      gameDuration: 25,
      breakBetween: 5,
      breakBeforePlayoffs: 30,
      playoffGameDuration: 30,
      playoffFormat: 'top2',
      numFields: 3
    },
    venues: [
      { id: 'field-1', name: 'Field 1' },
      { id: 'field-2', name: 'Field 2' },
      { id: 'field-3', name: 'Field 3' }
    ],
    groups: [
      { id: 'group-a', name: 'Group A', teams: ['A1', 'A2', 'A3', 'A4', 'A5'] },
      { id: 'group-b', name: 'Group B', teams: ['B1', 'B2', 'B3', 'B4', 'B5'] }
    ],
    blockedWindows: []
  });

  const groupFixtures = result.fixtures.filter(fixture => fixture.phase === 'group');
  const groupSlots = [...new Set(groupFixtures.map(fixture => fixture.slot))].sort((a, b) => a - b);

  assert.equal(groupFixtures.length, 20);
  assert.equal(groupSlots.length, 7);

  groupSlots.forEach((slot, index) => {
    const gamesInSlot = groupFixtures.filter(fixture => fixture.slot === slot);
    const expectedGames = index === groupSlots.length - 1 ? 2 : 3;
    assert.equal(gamesInSlot.length, expectedGames);
  });

  const slotsByTeam = {};
  groupFixtures.forEach(fixture => {
    [fixture.teamA, fixture.teamB].forEach(team => {
      slotsByTeam[team] = slotsByTeam[team] || [];
      slotsByTeam[team].push(fixture.slot);
    });
  });

  Object.entries(slotsByTeam).forEach(([team, slots]) => {
    const ordered = [...new Set(slots)].sort((a, b) => a - b);
    for (let i = 2; i < ordered.length; i++) {
      assert.notEqual(
        ordered[i - 2] + 1 === ordered[i - 1] && ordered[i - 1] + 1 === ordered[i],
        true,
        `${team} plays three consecutive slots: ${ordered.join(', ')}`
      );
    }
  });
});
