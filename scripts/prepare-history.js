import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import players from '../data/players.json' with { type: 'json' };
import { validateSession, ranking } from '../src/model.js';
import { encodeSession, encodeRounds } from '../src/session-codec.js';
import { toFirestoreValue } from './firestore-values.js';

const directory = process.argv[2] || 'output/history';
const read = async name => JSON.parse(await readFile(`${directory}/${name}`, 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const sources = await Promise.all([read('numbers-0.json'), read('numbers-1.json')]);
const candidate = await read('import-candidate.json'), verified = await read('verified-2026-10-04.json');
candidate.decisions.quarterOpeningTotals = 'canonical user-confirmed match records; original aggregate retained only as superseded source';
if (verified.status !== 'canonical-user-confirmed' || verified.date !== '2026-10-04' || verified.records.length !== 8) throw new Error('Canonical confirmation missing.');
const documents = [];
const add = (path, data, timestamps = ['importedAt']) => documents.push({ path: `clubs/gdr/${path}`, data: { schemaVersion: 1, ...data }, timestamps });
const identities = new Map(players.map(player => [player.name, player.id]));
for (const row of candidate.careerIndividuals) if (!identities.has(row.name)) identities.set(row.name, `past-${sha(row.name).slice(0, 12)}`);
const byShort = new Map(players.filter(player => player.shortName !== '진우').map(player => [player.shortName, player.id]));
for (const [name, id] of identities) if (id.startsWith('past-') && name !== '송진우') byShort.set(name.slice(1), id);
const identity = name => name === '진우' || name === 'Guest' ? null : identities.get(name) || byShort.get(name) || null;
const sourceIds = [];
for (const [index, source] of sources.entries()) {
  const sourceBytes = await readFile(source.source), sourceId = `numbers-${sha(sourceBytes).slice(0, 16)}`;
  sourceIds.push(sourceId);
  const tables = source.sheets.flatMap(sheet => sheet.tables.map(table => ({
    sheet: sheet.name, name: table.name, rowCount: table.rowCount, columnCount: table.columnCount,
    cells: Object.fromEntries(table.rows.flatMap((row, r) => row.flatMap((value, c) => value === null ? [] : [[`r${r + 1}c${c + 1}`, value]]))),
  })));
  add(`historySources/${sourceId}`, { originalFilename: basename(source.source), sourceSha256: sha(sourceBytes), extractedSha256: sha(JSON.stringify(source)), format: 'numbers-values', valuesOnly: true, tables });
}
const addSet = (id, data) => add(`historySets/${id}`, { id, ...data, contributesToLiveRanking: false, contributesToRatings: false });
const location = (sourceIndex, range) => ({ sourceId: sourceIds[sourceIndex], sheet: 'Sheet1', table: '표 1', range });
const people = candidate.careerIndividuals.map(row => ({ ...row, playerId: identities.get(row.name), source: location(1, `A${row.sourceRow}:H${row.sourceRow}`) }));
addSet('career-2026-06', { kind: 'individual-aggregate', title: '통산 개인 기록 · 2026년 6월 기준', cutoff: '2026-06', datePrecision: 'month', periodStart: null, status: 'mixed-validation', rows: people, source: location(1, 'A3:H30') });
const pairRows = candidate.careerPairs.map(row => ({
  ...row, playerIds: row.names.map(identity),
  stats: row.status === 'validated-pair-aggregate' ? { wins: row.sides[0].stats[0], losses: row.sides[0].stats[1], draws: row.sides[0].stats[2], games: row.sides[0].stats.reduce((sum, n) => sum + n, 0) } : null,
}));
addSet('partners-2026-06', { kind: 'partner-aggregate', title: '통산 파트너 기록 · 2026년 6월 기준', cutoff: '2026-06', datePrecision: 'month', periodStart: null, status: 'mixed-validation', rows: pairRows, source: location(1, 'M3:AN30'), note: '함께 뛴 페어의 집계. 상대 페어 정보 없음. 다른 개인 집계·날짜별 경기와 합산하지 않음.' });
const rows0 = sources[0].sheets[0].tables[0].rows;
const halfRows = rows0.slice(17, 29).map((row, index) => ({
  sourceRow: index + 18, name: row[1], playerId: identity(row[1]), status: row[1] === '진우' ? 'identity-unconfirmed' : 'validated-arithmetic',
  stats: { rank: row[0], points: row[2], games: row[3], wins: row[4], draws: row[5], losses: row[6], winRate: row[7], scored: row[8], conceded: row[9], difference: row[10] },
  issues: row[1] === '진우' ? ['같은 이름의 두 멤버 중 누구의 누적인지 확인 필요'] : [],
}));
for (const row of halfRows) if (row.stats.points !== 3 * row.stats.wins + row.stats.draws || row.stats.games !== row.stats.wins + row.stats.draws + row.stats.losses || row.stats.difference !== row.stats.scored - row.stats.conceded) throw new Error('Unexpected half-year arithmetic mismatch.');
addSet('half-2026-H2-10-04', { kind: 'individual-aggregate', title: '2026년 하반기 누적 · 10/4 기준', cutoff: '2026-10-04', period: '2026-H2', periodStart: '2026-07-01', datePrecision: 'day', status: 'coverage-and-identity-review', rows: halfRows, source: location(0, 'A18:K29'), note: '3·4분기 누적 스냅샷. 10/4 실제 경기도 포함하므로 다시 더하지 않음. 원본 진우 수치는 보존하며 임의로 정정하지 않음.' });
for (const week of candidate.weeklyUnconfirmedYear) {
  const label = week.label.match(/^\d+\/\d+/)[0];
  addSet(`weekly-year-unknown-${label.replace('/', '-')}`, { kind: 'daily-individual-aggregate', title: `연도 미확인 · ${label} 당일 결과`, cutoff: null, monthDay: label, year: null, datePrecision: 'unconfirmed', status: 'date-unconfirmed', rows: week.members, source: location(0, `N${week.sourceRow}:U${week.members.at(-1).sourceRow}`), note: '연도와 일부 인물·계산 확인 전 분기 순위·개인 경기 통계에 합산하지 않음.' });
}
addSet('original-daily-2026-10-04', { kind: 'daily-individual-aggregate', title: '10/4 원본 개인 집계 · 정정 전', cutoff: '2026-10-04', datePrecision: 'day', status: 'superseded', rows: candidate.originalDaily20261004.members, reconciliation: candidate.originalDaily20261004.reconciliation, source: location(0, 'D43:K52'), supersededBy: 'canonical-2026-10-04' });
addSet('canonical-2026-10-04', { kind: 'canonical-provenance', title: '10/4 실제 경기 · 사용자 확인 정본', cutoff: '2026-10-04', status: verified.status, rows: verified.rows, records: verified.records, corrections: verified.differences, roundOrder: verified.roundOrder, timeSource: '기본 모임 시간 19:00–21:00 적용. 각 코트의 텍스트 순서를 라운드 순서로 해석.', reconciliation: verified.totals, activeSessionPath: 'clubs/gdr/sessions/2026-10-04' });
addSet('import-review-v1', { kind: 'import-review', title: '기존 기록 검토 상태', status: 'review-preserved', rows: [], decisions: candidate.decisions, note: '정본 경기는 현재 순위에 반영. 이전 집계는 서로 범위가 겹치므로 독립 스냅샷으로 보관. 계산 불일치와 이름·연도 미확인 수치는 원본 그대로 보존.' });

const ids = [...new Set(verified.records.flatMap(record => [...record.teamA, ...record.teamB]))].sort();
const matchMap = Object.fromEntries(verified.records.map(({ round, court, teamA, teamB }) => [`r${round}-c${court}`, { round, court, teamA, teamB }]));
const pairs = new Map();
for (const match of Object.values(matchMap)) for (const team of [match.teamA, match.teamB]) { const key = [...team].sort().join('|'); pairs.set(key, (pairs.get(key) || 0) + 1); }
const session = { schemaVersion: 1, date: verified.date, participantIds: ids, fixedPlayerIds: ids, startTime: '19:00', endTime: '21:00', roundMinutes: 30, partnerRepeats: [...pairs.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0), lockedPairs: [], matchMap };
validateSession(session, players.map(player => player.id));
const ranked = ranking(verified.records, players).filter(row => row.games);
if (ranked.reduce((sum, row) => sum + row.scored, 0) !== 154 || ranked.reduce((sum, row) => sum + row.conceded, 0) !== 154) throw new Error('Canonical totals mismatch.');
const sim = ranked.find(row => row.id === 'gdr009');
if (sim.scored !== 16 || sim.conceded !== 14 || sim.points !== 6) throw new Error('Canonical correction mismatch.');
add('sessions/2026-10-04', encodeSession(session), ['createdAt']);
for (const [round, data] of Object.entries(encodeRounds(session))) add(`sessions/2026-10-04/rounds/${round}`, data, []);
for (const { round, court, scoreA, scoreB, outcome } of verified.records) add(`matchResults/2026-10-04_r${round}-c${court}`, { date: verified.date, matchId: `r${round}-c${court}`, scoreA, scoreB, outcome, revision: 1 }, ['updatedAt']);
// Result/round schemas do not use schemaVersion.
for (const entry of documents) if (/\/matchResults\/|\/rounds\//.test(entry.path)) delete entry.data.schemaVersion;
const contentDigest = sha(JSON.stringify(documents));
add(`historyImports/${contentDigest.slice(0, 24)}`, { contentDigest, status: 'complete', sourceIds, activeSession: verified.date, activeMatches: 8, archivedSets: documents.filter(entry => entry.path.includes('/historySets/')).length, archivedSources: sources.length, sourceValues: documents.filter(entry => entry.path.includes('/historySources/')).reduce((sum, entry) => sum + entry.data.tables.reduce((n, table) => n + Object.keys(table.cells).length, 0), 0) });
for (const document of documents) {
  const fields = toFirestoreValue(document.data).mapValue.fields;
  if (Buffer.byteLength(JSON.stringify(fields)) > 900_000) throw new Error('Archive exceeds safe document size.');
  if (document.data.originalFilename?.includes('/')) throw new Error('Archive contains local source path.');
}
const plan = { projectId: 'guldari', databaseId: '(default)', contentDigest, documents };
await writeFile(`${directory}/firestore-import-plan.json`, JSON.stringify(plan, null, 2));
console.log(JSON.stringify({ mode: 'prepared-not-written', documents: documents.length, ...documents.at(-1).data, sessionParticipants: ids.length, sourceFilesIncludedInGit: false }, null, 2));
