import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { generateSchedule, allocateForWindow } from '../src/scheduler.js';
import { initialStrengths, strengthsForSession } from '../src/ratings.js';
import { STRENGTH_STEP } from '../src/pairing-policy.js';
import { validateSession } from '../src/model.js';
import players from '../data/players.json' with { type: 'json' };
import baseline from '../data/strength-baseline.json' with { type: 'json' };
import { GUEST_STRENGTH } from '../src/guests.js';

const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const runs = Number(option('--runs') || 30);
if (!Number.isInteger(runs) || runs < 10 || runs > 200) throw new Error('--runs must be an integer between 10 and 200.');
const mode = option('--mode') || 'rolling';
if (!['rolling', 'fresh'].includes(mode)) throw new Error('--mode must be rolling or fresh.');
const input = option('--input') ? JSON.parse(await readFile(option('--input'), 'utf8')) : { records: [], history: [], state: { sessions: {} } };
const allIds = players.map(player => player.id), ids14 = allIds.slice(0, 14);
const names = Object.fromEntries(players.map(player => [player.id, player.name]));
const initial = initialStrengths(allIds, baseline);
const current = strengthsForSession(input.records, allIds, baseline, '2026-10-11', input.history);
const versions = [{ name: 'new', generate: generateSchedule }];
if (option('--compare-ref')) {
  let source = execFileSync('git', ['show', `${option('--compare-ref')}:src/scheduler.js`], { encoding: 'utf8' }).replace("'./model.js'", JSON.stringify(pathToFileURL(process.cwd() + '/src/model.js').href));
  if (source.includes("'./pairing-policy.js'")) {
    const policy = execFileSync('git', ['show', `${option('--compare-ref')}:src/pairing-policy.js`], { encoding: 'utf8' }).replace("'./model.js'", JSON.stringify(pathToFileURL(process.cwd() + '/src/model.js').href)).replace("'./periods.js'", JSON.stringify(pathToFileURL(process.cwd() + '/src/periods.js').href));
    source = source.replace("'./pairing-policy.js'", JSON.stringify('data:text/javascript;base64,' + Buffer.from(policy).toString('base64')));
  }
  versions.unshift({ name: option('--compare-ref'), generate: (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).generateSchedule });
}
function seeded(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
const ids10 = ['gdr001', 'gdr002', 'gdr003', 'gdr004', 'gdr006', 'gdr007', 'gdr009', 'gdr010', 'gdr011', 'gdr012'];
const cases = [
  { name: '14 members, 4 rounds', ids: ids14, rounds: 4 },
  { name: '10 members, 4 rounds', ids: ids10, rounds: 4 },
  { name: '14 members, 6 rounds', ids: ids14, rounds: 6 },
  { name: '8–14 changing attendees', ids: ids14, rounds: 4, variable: true },
  { name: '14 members, 7 fixed pairs', ids: ids14, rounds: 4, lockedPairs: baseline.groups },
  { name: '14 members, changing ratings', ids: ids14, rounds: 4, drift: true },
  { name: '14 members and 2 guests', ids: [...ids14, 'guest001', 'guest002'], rounds: 4 },
];
const report = { runs, mode, inputMatches: input.records.length, historySets: input.history.length, initial, current, sequence: mode === 'fresh' ? 'Repeated draws for 2026-10-11 against unchanged saved history; previews are never added to history.' : 'Independent blocks of 10 hypothetical weekly meetings within 2026 H2. Recent schedules reset between blocks.', cases: [] };
for (const scenario of cases) for (const version of versions) {
  const stats = {}, gaps = [], courtGaps = [], meetingCourtGaps = [], durations = [], cohorts = { top: 0, bottom: 0, upperSix: 0, lowerSix: 0, withinTwoSteps: 0 };
  let recent = [], rests = 0, partnerRepeats = 0;
  for (let sample = 0; sample < runs; sample++) {
    if (mode === 'fresh' || sample % 10 === 0) recent = Object.values(input.state.sessions);
    const week = sample % 10;
    const date = mode === 'fresh' ? '2026-10-11' : new Date(Date.UTC(2026, 9, 11 + week * 7)).toISOString().slice(0, 10);
    const random = seeded(9137 + sample * 104729);
    let ids = scenario.ids;
    if (scenario.variable) ids = [...ids].map(id => ({ id, value: random() })).sort((a, b) => a.value - b.value).slice(0, [8, 10, 12, 14][sample % 4]).map(item => item.id);
    const units = scenario.lockedPairs || ids.map(id => [id]);
    const offset = sample % units.length;
    const order = [...units.slice(offset), ...units.slice(0, offset)].flat();
    const slots = scenario.rounds * (ids.length >= 8 ? 8 : 4);
    let quotas = Object.fromEntries(order.map((id, i) => [id, Math.floor(slots / ids.length) + Number(i < slots % ids.length)]));
    if (mode === 'fresh') {
      const originalRandom = Math.random;
      try { Math.random = random; quotas = allocateForWindow(ids, scenario.rounds, scenario.lockedPairs || []); }
      finally { Math.random = originalRandom; }
    }
    const strengths = { ...current, guest001: GUEST_STRENGTH, guest002: GUEST_STRENGTH };
    if (scenario.drift) ids14.forEach((id, index) => { strengths[id] = Math.max(0, Math.min(1, current[id] + 0.25 * (week / 9) * (index % 2 ? 1 : -1))); });
    const start = performance.now();
    const result = version.generate(ids, quotas, { strengths, lockedPairs: scenario.lockedPairs || [], previousSchedules: recent, meetingDate: date, random });
    durations.push(performance.now() - start);
    const fixedPlayerIds = ids.filter(id => allIds.includes(id));
    const guests = Object.fromEntries(ids.filter(id => id.startsWith('guest')).map(id => [id, { name: id }]));
    const session = { date, participantIds: ids, fixedPlayerIds, guests, matchMap: result.matchMap, startTime: '19:00', endTime: scenario.rounds === 6 ? '22:00' : '21:00', roundMinutes: 30, lockedPairs: scenario.lockedPairs || [] };
    validateSession(session, allIds);
    rests += result.consecutiveRests;
    partnerRepeats += result.partnerRepeats;
    for (const id of ids) {
      stats[id] ??= { games: 0, meetings: 0, partners: {}, partnerDraws: {}, opponents: {}, expected: {} };
      stats[id].meetings++;
      const actual = Object.values(result.matchMap).filter(match => [...match.teamA, ...match.teamB].includes(id)).length;
      if (actual !== quotas[id]) throw new Error('Quota changed.');
      const met = new Set(Object.values(result.matchMap).flatMap(match => [match.teamA, match.teamB]).filter(team => team.includes(id)).flatMap(team => team.filter(other => other !== id)));
      for (const other of met) stats[id].partnerDraws[other] = (stats[id].partnerDraws[other] || 0) + 1;
      for (const other of ids.filter(other => other !== id)) stats[id].expected[other] = (stats[id].expected[other] || 0) + quotas[id] / (ids.length - 1);
    }
    for (const match of Object.values(result.matchMap)) {
      const sum = team => team.reduce((total, id) => total + strengths[id], 0);
      gaps.push(Math.abs(sum(match.teamA) - sum(match.teamB)) / STRENGTH_STEP);
      const active = [...match.teamA, ...match.teamB];
      if (active.every(id => baseline.groups.slice(0, 2).flat().includes(id))) cohorts.top++;
      if (active.every(id => baseline.groups.slice(-2).flat().includes(id))) cohorts.bottom++;
      if (active.every(id => baseline.groups.slice(0, 3).flat().includes(id))) cohorts.upperSix++;
      if (active.every(id => baseline.groups.slice(-3).flat().includes(id))) cohorts.lowerSix++;
      const activeStrengths = active.map(id => strengths[id]);
      if (Math.max(...activeStrengths) - Math.min(...activeStrengths) <= 2 * STRENGTH_STEP + 1e-8) cohorts.withinTwoSteps++;
      for (const pair of scenario.lockedPairs || []) if (active.includes(pair[0]) && ![match.teamA, match.teamB].some(team => pair.every(id => team.includes(id)))) throw new Error('Fixed pair changed.');
      for (const [team, other] of [[match.teamA, match.teamB], [match.teamB, match.teamA]]) for (const id of team) {
        const row = stats[id], partner = team.find(partner => partner !== id);
        row.games++; row.partners[partner] = (row.partners[partner] || 0) + 1;
        for (const opponent of other) row.opponents[opponent] = (row.opponents[opponent] || 0) + 1;
      }
    }
    for (let round = 1; round <= scenario.rounds; round++) {
      const matches = Object.values(result.matchMap).filter(match => match.round === round);
      if (matches.length === 2) { const sum = match => [...match.teamA, ...match.teamB].reduce((value, id) => value + strengths[id], 0); courtGaps.push(Math.abs(sum(matches[0]) - sum(matches[1])) / (2 * STRENGTH_STEP)); }
    }
    const courtTotals = [1, 2].map(court => Object.values(result.matchMap).filter(match => match.court === court).flatMap(match => [...match.teamA, ...match.teamB]).reduce((sum, id) => sum + strengths[id], 0));
    meetingCourtGaps.push(Math.abs(courtTotals[0] - courtTotals[1]) / (2 * STRENGTH_STEP));
    if (mode === 'rolling') recent.push(session);
  }
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
  const rows = Object.entries(stats).map(([id, row]) => {
    const pct = count => +(100 * count / row.games).toFixed(1);
    const expected = Object.entries(row.expected);
    const deviation = (counts, multiplier) => Math.sqrt(mean(expected.map(([other, value]) => ((counts[other] || 0) - multiplier * value) ** 2))) / mean(expected.map(([, value]) => multiplier * value));
    return { id, name: names[id] || id, games: row.games, meetings: row.meetings, uniquePartners: Object.keys(row.partners).length, maxPartnerPercent: pct(Math.max(...Object.values(row.partners))), partnerDrawPercent: Object.fromEntries(Object.entries(row.partnerDraws).map(([other, count]) => [other, +(100 * count / row.meetings).toFixed(1)])), maxOpponentPercent: pct(Math.max(...Object.values(row.opponents))) / 2, lowPartnerPercent: pct((row.partners.gdr010 || 0) + (row.partners.gdr011 || 0)), partnerDeviation: deviation(row.partners, 1), opponentDeviation: deviation(row.opponents, 2), partners: row.partners, opponents: row.opponents };
  });
  const result = { scenario: scenario.name, version: version.name, matches: gaps.length, rests, partnerRepeats, cohorts, teamGap: { mean: mean(gaps), p95: percentile(gaps, 0.95), max: Math.max(...gaps), above2Percent: 100 * gaps.filter(gap => gap > 2 + 1e-8).length / gaps.length, above3Percent: 100 * gaps.filter(gap => gap > 3 + 1e-8).length / gaps.length, above4Percent: 100 * gaps.filter(gap => gap > 4 + 1e-8).length / gaps.length }, courtGapMean: mean(courtGaps), meetingCourtGap: { mean: mean(meetingCourtGaps), max: Math.max(...meetingCourtGaps) }, partnerDeviationMean: mean(rows.map(row => row.partnerDeviation)), opponentDeviationMean: mean(rows.map(row => row.opponentDeviation)), durationMs: { mean: mean(durations), p95: percentile(durations, 0.95) }, players: rows };
  report.cases.push(result);
  console.log(JSON.stringify({ ...result, players: rows.filter(row => ['gdr001', 'gdr002'].includes(row.id)) }));
}
const output = option('--output') || 'output/analysis/scheduler-simulation.json';
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
