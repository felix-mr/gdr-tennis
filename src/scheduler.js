import { MAX_ROUNDS } from './model.js';
// Retained for old fixed-target schedules. New schedules use the meeting window.
export function allocateGames(ids, target, totals = {}) {
  if (ids.length < 4 || new Set(ids).size !== ids.length) throw new Error('참가자 4명 이상을 중복 없이 선택해 주세요.');
  if (![2, 3, 4].includes(target)) throw new Error('목표 경기 수는 2~4경기입니다.');
  const min = Math.ceil(ids.length * 2 / 4) * 4, max = Math.floor(ids.length * 4 / 4) * 4;
  const slots = Math.min(max, Math.max(min, Math.round(ids.length * target / 4) * 4));
  const counts = Object.fromEntries(ids.map(id => [id, 2]));
  for (let assigned = ids.length * 2; assigned < slots; assigned++) {
    const next = ids.filter(id => counts[id] < 4).sort((a, b) => counts[a] - counts[b] || (totals[a] || 0) - (totals[b] || 0) || a.localeCompare(b))[0];
    counts[next]++;
  }
  return counts;
}
const pairKey = (a, b) => [a, b].sort().join('|');
export function generateSchedule(ids, quotas, { random = Math.random, attempts = 250, strengths = {}, lockedPairs = [], preferredPairs = [] } = {}) {
  if (ids.length < 4 || new Set(ids).size !== ids.length || Object.keys(quotas).length !== ids.length || ids.some(id => !Number.isInteger(quotas[id]) || quotas[id] < 1 || quotas[id] > MAX_ROUNDS)) throw new Error('참가자별 경기 수를 모임 시간에 맞춰 주세요.');
  const units = pairUnits(ids, lockedPairs);
  pairUnits(ids, preferredPairs);
  const allPreferred = [...lockedPairs, ...preferredPairs];
  const preferred = Object.fromEntries(allPreferred.flatMap(([a, b]) => [[a, b], [b, a]]));
  const fixedKeys = new Set(allPreferred.map(pair => pairKey(...pair)));
  for (const pair of lockedPairs) if (quotas[pair[0]] !== quotas[pair[1]]) throw new Error('대회 준비 페어의 경기 수를 같게 맞춰 주세요.');
  const slots = ids.reduce((sum, id) => sum + quotas[id], 0);
  if (slots % 4) throw new Error(`총 ${slots}회 배정입니다. 복식은 총합이 4의 배수여야 합니다. 개인 경기 수를 조정해 주세요.`);
  const rounds = Math.max(...Object.values(quotas), Math.ceil(slots / (ids.length >= 8 ? 8 : 4)));
  if (rounds > MAX_ROUNDS) throw new Error('모임 시간을 같은 날 안에서 설정해 주세요.');
  const strength = id => Number.isFinite(strengths[id]) && strengths[id] >= 0 && strengths[id] <= 1 ? strengths[id] : 0.5;
  let best = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const remaining = { ...quotas }, partners = {}, opponents = {}, lastActive = {}, restStreak = {}, matchMap = {};
    let remainingSlots = slots, cost = 0, failed = false;
    for (let round = 1; round <= rounds; round++) {
      const future = rounds - round;
      const available = ids.filter(id => remaining[id] > 0);
      const required = available.filter(id => remaining[id] > future);
      const capacity = ids.length >= 8 ? 8 : 4;
      let count = Math.min(capacity, Math.floor(available.length / 4) * 4, remainingSlots);
      if (remainingSlots - count < future * 4) count = remainingSlots - future * 4;
      if (count < 4 || count % 4 || required.length > count) { failed = true; break; }
      const availableUnits = units.filter(unit => remaining[unit[0]] > 0);
      const requiredUnits = availableUnits.filter(unit => remaining[unit[0]] > future);
      const requiredIds = requiredUnits.flat();
      const candidates = availableUnits.filter(unit => !requiredUnits.includes(unit)).map(unit => ({ unit, priority: remaining[unit[0]] * 10 + unit.reduce((sum, id) => sum + (restStreak[id] || 0), 0) / unit.length * 5 + random() * 12 })).sort((a, b) => b.priority - a.priority).map(item => item.unit);
      const choose = (index, needed) => {
        if (needed === 0) return [];
        if (needed < 0 || index === candidates.length) return null;
        const included = choose(index + 1, needed - candidates[index].length);
        return included ? [...candidates[index], ...included] : choose(index + 1, needed);
      };
      const optionalIds = choose(0, count - requiredIds.length);
      if (!optionalIds) { failed = true; break; }
      const active = [...requiredIds, ...optionalIds];
      let pairing = null;
      const teamTarget = active.reduce((sum, id) => sum + strength(id), 0) / (active.length / 2);
      for (let trial = 0; trial < 45; trial++) {
        const fixedTeams = lockedPairs.filter(pair => active.includes(pair[0]));
        const fixedIds = new Set(fixedTeams.flat());
        const loose = active.filter(id => !fixedIds.has(id)).map(id => ({ id, value: random() })).sort((a, b) => a.value - b.value).map(x => x.id);
        const teams = [...fixedTeams];
        for (let i = 0; i < loose.length; i += 2) teams.push(loose.slice(i, i + 2));
        const shuffled = teams.map(team => ({ team, value: random() })).sort((a, b) => a.value - b.value).flatMap(x => x.team);
        let penalty = 0;
        for (let i = 0; i < shuffled.length; i += 4) {
          const strengthA = strength(shuffled[i]) + strength(shuffled[i + 1]);
          const strengthB = strength(shuffled[i + 2]) + strength(shuffled[i + 3]);
          penalty += 80 * (strengthA - strengthB) ** 2 + 30 * ((strengthA - teamTarget) ** 2 + (strengthB - teamTarget) ** 2);
          for (const team of [shuffled.slice(i, i + 2), shuffled.slice(i + 2, i + 4)]) { const key = pairKey(...team); if (!fixedKeys.has(key)) penalty += (partners[key] || 0) * 100; for (const id of team) if (preferred[id] && !team.includes(preferred[id])) penalty += 250; }
          for (const a of shuffled.slice(i, i + 2)) for (const b of shuffled.slice(i + 2, i + 4)) penalty += (opponents[pairKey(a, b)] || 0) * 2;
        }
        if (!pairing || penalty < pairing.penalty) pairing = { shuffled, penalty };
      }
      cost += pairing.penalty;
      for (let i = 0; i < pairing.shuffled.length; i += 4) {
        const teamA = pairing.shuffled.slice(i, i + 2), teamB = pairing.shuffled.slice(i + 2, i + 4), court = i / 4 + 1;
        matchMap[`r${round}-c${court}`] = { round, court, teamA, teamB };
        for (const team of [teamA, teamB]) { const key = pairKey(...team); partners[key] = (partners[key] || 0) + 1; }
        for (const a of teamA) for (const b of teamB) { const key = pairKey(a, b); opponents[key] = (opponents[key] || 0) + 1; }
      }
      for (const id of ids) {
        if (active.includes(id)) { remaining[id]--; restStreak[id] = 0; lastActive[id] = round; }
        else { restStreak[id] = (restStreak[id] || 0) + 1; cost += restStreak[id] > 1 ? 8 : 0; }
      }
      remainingSlots -= count;
    }
    if (!failed && remainingSlots === 0 && Object.values(remaining).every(n => !n) && (!best || cost < best.cost)) best = { matchMap, cost, partnerRepeats: Object.entries(partners).filter(([key]) => !fixedKeys.has(key)).reduce((s, [, n]) => s + Math.max(0, n - 1), 0) };
  }
  if (!best && lockedPairs.length) return generateSchedule(ids, quotas, { random, attempts, strengths, preferredPairs: lockedPairs });
  if (!best) throw new Error('이 경기 수 조합으로 배정하지 못했습니다. 개인 경기 수를 고르게 조정해 주세요.');
  const gaps = Object.values(best.matchMap).map(match => Math.abs(match.teamA.reduce((sum, id) => sum + strength(id), 0) - match.teamB.reduce((sum, id) => sum + strength(id), 0)));
  best.balance = { averageGap: gaps.reduce((a, b) => a + b, 0) / gaps.length, maxGap: Math.max(...gaps) };
  return best;
}

export function allocateForWindow(ids, rounds, lockedPairs = []) {
  if (ids.length < 4 || new Set(ids).size !== ids.length) throw new Error('참가자 4명 이상을 중복 없이 선택해 주세요.');
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error('모임 종료 시간을 시작 시간보다 뒤로 설정해 주세요.');
  if (rounds > MAX_ROUNDS) throw new Error('모임 시간을 같은 날 안에서 설정해 주세요.');
  const slots = rounds * (ids.length >= 8 ? 8 : 4);
  if (slots < ids.length) throw new Error('모두 한 경기씩 하기에 시간이 부족합니다. 모임 시간을 늘려 주세요.');
  const units = pairUnits(ids, lockedPairs);
  const candidates = units.map(unit => ({ unit, order: Math.random() })).sort((a, b) => a.order - b.order).map(item => item.unit);
  const base = Math.floor(slots / ids.length);
  const chooseExtras = (index, needed) => {
    if (!needed) return [];
    if (needed < 0 || index === candidates.length) return null;
    const included = chooseExtras(index + 1, needed - candidates[index].length);
    return included ? [...candidates[index], ...included] : chooseExtras(index + 1, needed);
  };
  const extras = chooseExtras(0, slots - base * ids.length);
  if (!extras) throw new Error('대회 준비 페어의 경기 수를 배정하지 못했습니다. 참석자 또는 페어를 확인해 주세요.');
  const additional = new Set(extras);
  return Object.fromEntries(ids.map(id => [id, base + Number(additional.has(id))]));
}

function pairUnits(ids, pairs) {
  const used = new Set();
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1] || pair.some(id => !ids.includes(id) || used.has(id))) throw new Error('대회 준비 페어는 참석자 두 명을 중복 없이 지정해 주세요.');
    pair.forEach(id => used.add(id));
  }
  return [...pairs, ...ids.filter(id => !used.has(id)).map(id => [id])];
}
