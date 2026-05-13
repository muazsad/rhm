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
