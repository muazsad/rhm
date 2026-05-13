(function (window) {
  function groupLetter(index) {
    return String.fromCharCode(65 + index);
  }

  function groupId(index) {
    return 'group-' + groupLetter(index).toLowerCase();
  }

  function parseTeamList(value) {
    var result = [];
    var values;

    if (Array.isArray(value)) {
      values = value;
    } else {
      values = String(value || '').split(/[\n,]/);
    }

    values.forEach(function (team) {
      var cleanTeam = String(team || '').trim();
      if (cleanTeam) result.push(cleanTeam);
    });

    return result;
  }

  function normalizeManualGroups(groups) {
    var normalized = [];

    (groups || []).forEach(function (group) {
      var teams = parseTeamList(group && group.teams ? group.teams : []);
      if (!teams.length) return;

      var index = normalized.length;
      var name = String(group && group.name ? group.name : '').trim() || 'Group ' + groupLetter(index);
      normalized.push({
        id: groupId(index),
        name: name,
        teams: teams
      });
    });

    return normalized;
  }

  function createEmptyGroups(numGroups) {
    var groups = [];
    var count = Math.max(1, parseInt(numGroups, 10) || 1);

    for (var i = 0; i < count; i++) {
      groups.push({
        id: groupId(i),
        name: 'Group ' + groupLetter(i),
        teams: []
      });
    }

    return groups;
  }

  function shuffleTeams(teams, random) {
    var randomFn = typeof random === 'function' ? random : Math.random;

    return teams.map(function (team, index) {
      return {
        index: index,
        key: randomFn(),
        team: team
      };
    }).sort(function (a, b) {
      if (a.key === b.key) return b.index - a.index;
      return b.key - a.key;
    }).map(function (item) {
      return item.team;
    });
  }

  function distributeStraight(teams, groups) {
    teams.forEach(function (team, index) {
      groups[index % groups.length].teams.push(team);
    });
  }

  function distributeSeeded(teams, groups) {
    teams.forEach(function (team, index) {
      var round = Math.floor(index / groups.length);
      var position = index % groups.length;
      var groupIndex = round % 2 === 0 ? position : groups.length - 1 - position;
      groups[groupIndex].teams.push(team);
    });
  }

  function buildGroupsFromTeamList(options) {
    var config = options || {};
    var groups = createEmptyGroups(config.numGroups);
    var teams = parseTeamList(config.teams);

    if (config.method === 'random') {
      distributeStraight(shuffleTeams(teams, config.random), groups);
    } else {
      distributeSeeded(teams, groups);
    }

    return groups;
  }

  function defaultVenueNames(sport, count) {
    var total = Math.max(0, parseInt(count, 10) || 0);
    var label = String(sport || '').toLowerCase() === 'basketball' ? 'Court' : 'Field';
    var names = [];

    for (var i = 1; i <= total; i++) {
      names.push(label + ' ' + i);
    }

    return names;
  }

  window.RHMTournamentGroups = {
    parseTeamList: parseTeamList,
    normalizeManualGroups: normalizeManualGroups,
    buildGroupsFromTeamList: buildGroupsFromTeamList,
    defaultVenueNames: defaultVenueNames
  };
})(window);
