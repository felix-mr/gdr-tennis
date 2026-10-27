import { minimumMixedMatches } from './mixing-policy.js';
// Feasibility fallback for uneven attendance. Fixed pairs are indivisible units;
// match composition is planned before score-based partner selection.
export function boundedMixingPlan(ids, quotas, leagues, pairs, rounds, { random = Math.random, maxStates = 20000, strengths = {} } = {}) {
  if (ids.length < 8 || !ids.every(id => [0, 1].includes(leagues[id])) || [0, 1].some(group => ids.filter(id => leagues[id] === group).length < 4) || pairs.some(([a, b]) => leagues[a] !== leagues[b])) return null;
  const paired = new Set(pairs.flat());
  const units = [...pairs, ...ids.filter(id => !paired.has(id)).map(id => [id])];
  const initial = units.map((members, index) => ({ index, members, group: leagues[members[0]], games: quotas[members[0]], mixed: false, rest: 0, tie: random() }));
  const memo = new Set(); let visited = 0, work = 0;
  const keyOf = state => state.filter(unit => unit.games).map(unit => `${unit.members.length},${unit.group},${unit.games},${Number(unit.mixed)}`).sort().join(';');
  function* games(state) {
    const groups = new Map();
    for (const unit of state.filter(unit => unit.games)) {
      const key = `${unit.members.length},${unit.group},${unit.games},${Number(unit.mixed)}`;
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(unit);
    }
    const classes = [...groups.values()].map(list => list.sort((a, b) => b.rest - a.rest || a.tie - b.tie)).sort((a, b) => b[0].games - a[0].games || b[0].rest - a[0].rest || a[0].group - b[0].group);
    function* choose(index, needed, selected) {
      if (!needed) {
        const mixed = new Set(selected.map(unit => unit.group)).size > 1;
        if (!mixed) yield { selected, mixed };
        else if (selected.every(unit => !unit.mixed)) {
          const score = unit => unit.members.reduce((sum, id) => sum + (strengths[id] ?? 0.5), 0) / unit.members.length;
          const same = (a, b) => a.members.length === b.members.length && a.group === b.group && a.games === b.games && a.mixed === b.mixed;
          const boundary = classes.flatMap(list => list.slice().sort((a, b) => (a.group === 0 ? score(a) - score(b) : score(b) - score(a)) || b.rest - a.rest || a.tie - b.tie).slice(0, selected.filter(unit => same(unit, list[0])).length));
          yield { selected: boundary, mixed };
        }
        return;
      }
      if (index === classes.length) return;
      const list = classes[index], size = list[0].members.length;
      for (let count = Math.min(list.length, Math.floor(needed / size)); count >= 0; count--) yield* choose(index + 1, needed - count * size, [...selected, ...list.slice(0, count)]);
    }
    yield* choose(0, 4, []);
  }
  function search(state, remainingRounds, budget) {
    const active = state.filter(unit => unit.games), slots = active.reduce((sum, unit) => sum + unit.members.length * unit.games, 0);
    if (!remainingRounds) return slots ? null : [];
    if (slots < remainingRounds * 4 || slots > remainingRounds * 8 || active.some(unit => unit.games > remainingRounds)) return null;
    const key = `${remainingRounds}:${budget}:${keyOf(state)}`;
    if (memo.has(key) || ++visited > maxStates) return null;
    const totals = [0, 1].map(group => active.filter(unit => unit.group === group).reduce((sum, unit) => sum + unit.members.length * unit.games, 0));
    const unused = [0, 1].map(group => active.filter(unit => unit.group === group && !unit.mixed).reduce((sum, unit) => sum + unit.members.length, 0));
    let possible = false;
    for (let mixed = 0; mixed <= Math.min(budget, Math.floor((unused[0] + unused[1]) / 4)) && !possible; mixed++) for (let a = mixed; a <= Math.min(mixed * 3, unused[0]); a++) {
      const b = mixed * 4 - a;
      if (b >= mixed && b <= mixed * 3 && b <= unused[1] && totals[0] >= a && totals[1] >= b && (totals[0] - a) % 4 === 0 && (totals[1] - b) % 4 === 0) { possible = true; break; }
    }
    if (!possible) { memo.add(key); return null; }
    for (const count of [2, 1]) {
      if (slots - count * 4 < (remainingRounds - 1) * 4 || slots - count * 4 > (remainingRounds - 1) * 8) continue;
      for (const first of games(active)) {
        const selected = new Set(first.selected.map(unit => unit.index));
        const secondOptions = count === 2 ? games(active.filter(unit => !selected.has(unit.index))) : [{ selected: [], mixed: false }];
        for (const second of secondOptions) {
          if (++work > maxStates * 50) return null;
          const used = Number(first.mixed) + Number(second.mixed);
          if (used > budget) continue;
          const all = [...first.selected, ...second.selected], played = new Set(all.map(unit => unit.index));
          if (active.some(unit => unit.games === remainingRounds && !played.has(unit.index))) continue;
          const mixed = new Set([...(first.mixed ? first.selected : []), ...(second.mixed ? second.selected : [])].map(unit => unit.index));
          const next = state.map(unit => ({ ...unit, games: unit.games - Number(played.has(unit.index)), mixed: unit.mixed || mixed.has(unit.index), rest: played.has(unit.index) ? 0 : unit.rest + 1 }));
          const tail = search(next, remainingRounds - 1, budget - used);
          if (tail) return [[first.selected.flatMap(unit => unit.members), ...(count === 2 ? [second.selected.flatMap(unit => unit.members)] : [])], ...tail];
        }
      }
    }
    memo.add(key); return null;
  }
  const total = ids.reduce((sum, id) => sum + quotas[id], 0);
  const minimum = total === rounds * 8 ? minimumMixedMatches(ids, quotas, leagues, rounds) : 0;
  for (let budget = minimum; budget <= Math.floor(ids.length / 4); budget++) {
    const result = search(initial, rounds, budget);
    if (result) return result;
  }
  return null;
}
