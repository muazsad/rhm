(function (window) {
  function isNumericScore(value) {
    return value !== null && value !== '' && Number.isFinite(Number(value));
  }

  function scoreValue(value) {
    return Number(value);
  }

  function rulesWithDefaults(rules) {
    var config = rules || {};
    return {
      winPoints: Number.isFinite(Number(config.winPoints)) ? Number(config.winPoints) : 3,
      drawPoints: Number.isFinite(Number(config.drawPoints)) ? Number(config.drawPoints) : 1,
      lossPoints: Number.isFinite(Number(config.lossPoints)) ? Number(config.lossPoints) : 0,
      tiesAllowed: config.tiesAllowed !== false
    };
  }

  function createRow(team) {
    return {
      team: team,
      rank: 0,
      played: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      points: 0,
      pf: 0,
      pa: 0,
      diff: 0
    };
  }

  function groupFixtures(fixtures, groupId) {
    return (fixtures || []).filter(function (fixture) {
      return fixture &&
        fixture.phase === 'group' &&
        fixture.groupId === groupId &&
        isNumericScore(fixture.scoreA) &&
        isNumericScore(fixture.scoreB);
    });
  }

  function updateRow(row, scored, allowed) {
    row.played += 1;
    row.pf += scored;
    row.pa += allowed;
    row.diff = row.pf - row.pa;
  }

  function awardResult(row, scored, allowed, rules) {
    if (scored > allowed) {
      row.wins += 1;
      row.points += rules.winPoints;
      return;
    }

    if (scored < allowed) {
      row.losses += 1;
      row.points += rules.lossPoints;
      return;
    }

    if (rules.tiesAllowed) {
      row.draws += 1;
      row.points += rules.drawPoints;
    }
  }

  function applyFixture(rowsByTeam, fixture, rules) {
    var rowA = rowsByTeam[fixture.teamA];
    var rowB = rowsByTeam[fixture.teamB];
    var scoreA = scoreValue(fixture.scoreA);
    var scoreB = scoreValue(fixture.scoreB);

    if (!rowA || !rowB) return;

    updateRow(rowA, scoreA, scoreB);
    updateRow(rowB, scoreB, scoreA);
    awardResult(rowA, scoreA, scoreB, rules);
    awardResult(rowB, scoreB, scoreA, rules);
  }

  function headToHeadFor(team, opponent, fixtures, rules) {
    var result = {
      played: 0,
      points: 0,
      diff: 0
    };

    fixtures.forEach(function (fixture) {
      var isForward = fixture.teamA === team && fixture.teamB === opponent;
      var isReverse = fixture.teamA === opponent && fixture.teamB === team;
      if (!isForward && !isReverse) return;

      var scored = scoreValue(isForward ? fixture.scoreA : fixture.scoreB);
      var allowed = scoreValue(isForward ? fixture.scoreB : fixture.scoreA);
      result.played += 1;
      result.diff += scored - allowed;

      if (scored > allowed) {
        result.points += rules.winPoints;
      } else if (scored < allowed) {
        result.points += rules.lossPoints;
      } else if (rules.tiesAllowed) {
        result.points += rules.drawPoints;
      }
    });

    return result;
  }

  function compareRows(a, b, fixtures, rules) {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.diff !== a.diff) return b.diff - a.diff;
    return compareByPointsForAndName(a, b);
  }

  function compareHeadToHead(a, b, fixtures, rules) {
    var h2hA = headToHeadFor(a.team, b.team, fixtures, rules);
    var h2hB = headToHeadFor(b.team, a.team, fixtures, rules);
    if (h2hA.played && h2hB.played) {
      if (h2hB.points !== h2hA.points) return h2hB.points - h2hA.points;
      if (h2hB.diff !== h2hA.diff) return h2hB.diff - h2hA.diff;
    }

    return compareByPointsForAndName(a, b);
  }

  function compareByPointsForAndName(a, b) {
    if (b.pf !== a.pf) return b.pf - a.pf;
    return String(a.team).localeCompare(String(b.team));
  }

  function samePrimaryTie(a, b) {
    return a.points === b.points && a.wins === b.wins && a.diff === b.diff;
  }

  function rankRows(rows, fixtures, rules) {
    var ranked = rows.slice().sort(function (a, b) {
      return compareRows(a, b, fixtures, rules);
    });
    var result = [];
    var start = 0;

    while (start < ranked.length) {
      var end = start + 1;
      while (end < ranked.length && samePrimaryTie(ranked[start], ranked[end])) {
        end++;
      }

      var cohort = ranked.slice(start, end);
      if (cohort.length === 2) {
        cohort.sort(function (a, b) {
          return compareHeadToHead(a, b, fixtures, rules);
        });
      } else if (cohort.length > 2) {
        cohort.sort(compareByPointsForAndName);
      }

      result = result.concat(cohort);
      start = end;
    }

    return result;
  }

  function computeStandings(options) {
    var config = options || {};
    var rules = rulesWithDefaults(config.rules);

    return (config.groups || []).map(function (group) {
      var rowsByTeam = {};
      var rows = (group.teams || []).map(function (team) {
        var row = createRow(team);
        rowsByTeam[team] = row;
        return row;
      });
      var fixtures = groupFixtures(config.fixtures, group.id);

      fixtures.forEach(function (fixture) {
        applyFixture(rowsByTeam, fixture, rules);
      });

      rows = rankRows(rows, fixtures, rules);

      rows.forEach(function (row, index) {
        row.rank = index + 1;
      });

      return {
        groupId: group.id,
        groupName: group.name,
        rows: rows
      };
    });
  }

  function applySeedOverrides(rows, groupId, seedOverrides) {
    var ordered = new Array((rows || []).length);
    var byTeam = {};
    var used = {};

    (rows || []).forEach(function (row) {
      byTeam[row.team] = row;
    });

    (seedOverrides || []).forEach(function (override) {
      var seedIndex = parseInt(override && override.seed, 10) - 1;
      var row = override && override.groupId === groupId ? byTeam[override.team] : null;
      if (!row || used[row.team] || seedIndex < 0 || seedIndex >= ordered.length || ordered[seedIndex]) return;

      ordered[seedIndex] = row;
      used[row.team] = true;
    });

    (rows || []).forEach(function (row) {
      if (used[row.team]) return;

      for (var i = 0; i < ordered.length; i++) {
        if (!ordered[i]) {
          ordered[i] = row;
          used[row.team] = true;
          return;
        }
      }
    });

    return ordered.filter(Boolean);
  }

  function projectSeeds(options) {
    var config = options || {};
    var advance = Math.max(0, parseInt(config.advancePerGroup, 10) || 0);
    var seeds = [];

    if (config.requireGroupResult && !hasScoredGroupFixture(config.fixtures || [])) {
      return seeds;
    }

    if (config.requireCompletedGroupStage && !hasCompletedGroupStage(config.fixtures || [])) {
      return seeds;
    }

    (config.standings || []).forEach(function (groupStanding) {
      var rows = applySeedOverrides(groupStanding.rows || [], groupStanding.groupId, config.seedOverrides).slice(0, advance);

      rows.forEach(function (row, index) {
        var seed = index + 1;
        seeds.push({
          groupId: groupStanding.groupId,
          groupName: groupStanding.groupName,
          seed: seed,
          team: row.team,
          label: groupStanding.groupName + ' Seed ' + seed
        });
      });
    });

    return seeds;
  }

  function hasScoredGroupFixture(fixtures) {
    return (fixtures || []).some(function (fixture) {
      return fixture &&
        fixture.phase === 'group' &&
        isNumericScore(fixture.scoreA) &&
        isNumericScore(fixture.scoreB);
    });
  }

  function hasCompletedGroupStage(fixtures) {
    var groupFixtures = (fixtures || []).filter(function (fixture) {
      return fixture && fixture.phase === 'group';
    });

    return groupFixtures.length > 0 && groupFixtures.every(function (fixture) {
      return isNumericScore(fixture.scoreA) && isNumericScore(fixture.scoreB);
    });
  }

  window.RHMTournamentStandings = {
    computeStandings: computeStandings,
    projectSeeds: projectSeeds,
    applySeedOverrides: applySeedOverrides,
    hasScoredGroupFixture: hasScoredGroupFixture,
    hasCompletedGroupStage: hasCompletedGroupStage
  };
})(window);
