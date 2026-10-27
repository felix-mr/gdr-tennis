// Pools stay inside the scheduler. They are never session fields or UI labels.
const unitsFor = (ids, pairs) => {
  const fixed = new Set(pairs.flat());
  return [...pairs, ...ids.filter(id => !fixed.has(id)).map(id => [id])];
};

export function poolFeasible(units, remaining, rounds, memo = new Map(), capacity = 4) {
  return canFillRounds(units.map(unit => [unit.length, remaining[unit[0]]]), rounds, memo, capacity);
}

function canFillRounds(units, rounds, memo, capacity) {
  const active = units.filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  if (!active.length) return rounds === 0;
  if (!rounds || active.some(([, n]) => n > rounds) || active.reduce((sum, [size, n]) => sum + size * n, 0) !== capacity * rounds) return false;
  const singles = active.filter(([size]) => size === 1);
  if (singles.length === 1 || (singles.length === 2 && singles[0][1] !== singles[1][1]) || (singles.length === 3 && singles.reduce((sum, [, n]) => sum + n, 0) > 2 * rounds)) return false;
  if (!singles.length) return true; // Every active unit is an intact pair.
  const key = `${capacity}:${rounds}:${JSON.stringify(active)}`;
  if (memo.has(key)) return memo.get(key);
  const groups = [];
  for (const [size, n] of active) {
    const last = groups.at(-1);
    if (last && last.size === size && last.n === n) last.count++;
    else groups.push({ size, n, count: 1 });
  }
  const choose = (index, slots, next) => {
    if (slots > capacity) return false;
    if (index === groups.length) {
      if (slots !== capacity) return false;
      return canFillRounds(next, rounds - 1, memo, capacity);
    }
    const { size, n, count } = groups[index], minimum = n === rounds ? count : 0;
    for (let take = Math.min(count, Math.floor((capacity - slots) / size)); take >= minimum; take--) {
      if (choose(index + 1, slots + take * size, [...next, ...Array.from({ length: take }, () => [size, n - 1]), ...Array.from({ length: count - take }, () => [size, n])])) return true;
    }
    return false;
  };
  const result = choose(0, 0, []); memo.set(key, result); return result;
}

function* unitQuotaOptions(pool, pairs, base, target, random) {
  const units = unitsFor(pool, pairs.filter(pair => pool.includes(pair[0])));
  const extra = target - base * pool.length;
  if (extra < 0 || extra > pool.length) return;
  const shuffled = size => units.filter(unit => unit.length === size).map(unit => ({ unit, order: random() })).sort((a, b) => a.order - b.order).map(item => item.unit);
  const paired = shuffled(2), singles = shuffled(1);
  const options = Array.from({ length: paired.length + 1 }, (_, n) => n).map(n => ({ n, order: random() })).sort((a, b) => a.order - b.order);
  for (const { n } of options) {
    const singleExtra = extra - 2 * n;
    if (singleExtra < 0 || singleExtra > singles.length) continue;
    const additional = new Set([...paired.slice(0, n), ...singles.slice(0, singleExtra)].flat());
    yield Object.fromEntries(pool.map(id => [id, base + Number(additional.has(id))]));
  }
}

export function allocateUnitQuotas(pool, pairs, rounds, base, random, memo = new Map(), capacity = 4) {
  const units = unitsFor(pool, pairs.filter(pair => pool.includes(pair[0])));
  for (const quotas of unitQuotaOptions(pool, pairs, base, capacity * rounds, random)) if (poolFeasible(units, quotas, rounds, memo, capacity)) return quotas;
  return null;
}

export function planLeaguePools(ids, rounds, pairs, { leagues = {}, strengths = {}, quotas, random = Math.random } = {}) {
  if (ids.length < 8 || !ids.every(id => [0, 1].includes(leagues[id])) || new Set(ids.map(id => leagues[id])).size < 2) return null;
  const capacity = 8 * rounds, base = Math.floor(8 * rounds / ids.length);
  if (base < 2 || (quotas && ids.reduce((sum, id) => sum + quotas[id], 0) !== 8 * rounds)) return null;
  const units = unitsFor(ids, pairs);
  let states = new Map([['0:0:0', { upper: [], lower: [], size: 0, paired: 0, slots: 0, cost: 0 }]]), processedSlots = 0;
  for (const unit of units) {
    const next = new Map(), slots = quotas ? unit.length * quotas[unit[0]] : 0;
    for (const state of states.values()) for (const league of [0, 1]) {
      const size = state.size + (league === 0 ? unit.length : 0);
      const paired = state.paired + Number(league === 0 && unit.length === 2);
      const total = state.slots + (league === 0 ? slots : 0);
      if (size > ids.length - 4 || (quotas && (total > capacity || processedSlots + slots - total > capacity))) continue;
      const cost = state.cost + unit.reduce((sum, id) => sum + (leagues[id] === league ? 0 : 10 + (league === 0 ? 1 - (strengths[id] ?? 0.5) : (strengths[id] ?? 0.5))), 0);
      const key = `${size}:${paired}:${total}`;
      if (!next.has(key) || cost < next.get(key).cost) next.set(key, { size, paired, slots: total, cost, upper: league === 0 ? [...state.upper, ...unit] : state.upper, lower: league === 1 ? [...state.lower, ...unit] : state.lower });
    }
    processedSlots += slots; states = next;
  }
  const candidates = [...states.values()].filter(state => state.size >= 4 && (!quotas || state.slots % 4 === 0)).sort((a, b) => a.cost - b.cost || Math.abs(a.size - ids.length / 2) - Math.abs(b.size - ids.length / 2));
  const memo = new Map();
  let fallback = null;
  for (const candidate of candidates) {
    if (fallback && candidate.cost > fallback.cost) return fallback.plan;
    const pools = [candidate.upper, candidate.lower];
    const groupedUnits = pools.map(pool => units.filter(unit => pool.includes(unit[0])));
    if (quotas) {
      if (poolsFeasible(groupedUnits, quotas, rounds, memo)) {
        const plan = { pools, quotas, moved: pools.reduce((sum, pool, index) => sum + pool.filter(id => leagues[id] !== index).length, 0) };
        if (poolsRestFeasible(groupedUnits, quotas, rounds, [], memo)) return plan;
        fallback ||= { plan, cost: candidate.cost };
      }
      continue;
    }
    const targets = Array.from({ length: rounds * 2 + 1 }, (_, i) => i * 4).filter(total => total >= base * pools[0].length && total <= (base + 1) * pools[0].length && capacity - total >= base * pools[1].length && capacity - total <= (base + 1) * pools[1].length).sort((a, b) => Math.abs(a - capacity / 2) - Math.abs(b - capacity / 2));
    for (const target of targets) {
      const first = [...unitQuotaOptions(pools[0], pairs, base, target, random)], second = [...unitQuotaOptions(pools[1], pairs, base, capacity - target, random)];
      for (const a of first) for (const b of second) {
        const games = { ...a, ...b };
        if (poolsFeasible(groupedUnits, games, rounds, memo)) {
          const plan = { pools, quotas: games, moved: pools.reduce((sum, pool, index) => sum + pool.filter(id => leagues[id] !== index).length, 0) };
          if (poolsRestFeasible(groupedUnits, games, rounds, [], memo)) return plan;
          fallback ||= { plan, cost: candidate.cost };
        }
      }
    }
  }
  return fallback?.plan || null;
}

function roundTransitions(state, capacity, rounds) {
  const groups = [];
  for (const [size, n] of state) {
    const last = groups.at(-1);
    if (last && last.size === size && last.n === n) last.count++;
    else groups.push({ size, n, count: 1 });
  }
  const results = [];
  function choose(index, slots, next) {
    if (slots > capacity) return;
    if (index === groups.length) { if (slots === capacity) results.push(next.filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0] || b[1] - a[1])); return; }
    const { size, n, count } = groups[index];
    for (let take = Math.min(count, Math.floor((capacity - slots) / size)); take >= (n === rounds ? count : 0); take--) choose(index + 1, slots + take * size, [...next, ...Array.from({ length: take }, () => [size, n - 1]), ...Array.from({ length: count - take }, () => [size, n])]);
  }
  choose(0, 0, []); return results;
}

export function poolsFeasible(unitsByPool, remaining, rounds, memo = new Map()) {
  const states = unitsByPool.map(units => units.map(unit => [unit.length, remaining[unit[0]]]).filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0] || b[1] - a[1]));
  return canFillPools(states, rounds, memo);
}

function canFillPools(states, rounds, memo) {
  const totals = states.map(state => state.reduce((sum, [size, n]) => sum + size * n, 0));
  if (!rounds) return totals.every(n => n === 0);
  if (totals.some(n => n % 4) || totals[0] + totals[1] !== 8 * rounds || states.some(state => state.some(([, n]) => n > rounds))) return false;
  if (states.some((state, i) => {
    const people = state.reduce((sum, [size]) => sum + size, 0), singles = state.filter(([size]) => size === 1);
    return totals[i] > (people >= 8 ? 8 : people >= 4 ? 4 : 0) * rounds || singles.length === 1 || (singles.length === 2 && singles[0][1] !== singles[1][1]) || (singles.length === 3 && singles.reduce((sum, [, n]) => sum + n, 0) > 2 * rounds);
  })) return false;
  if (totals.every(n => n === 4 * rounds) && states.every(state => canFillRounds(state, rounds, memo, 4))) return true;
  if (!totals[0]) return canFillRounds(states[1], rounds, memo, 8);
  if (!totals[1]) return canFillRounds(states[0], rounds, memo, 8);
  const key = `pools:${rounds}:${JSON.stringify(states)}`;
  if (memo.has(key)) return memo.get(key);
  for (const firstCount of [4, 8, 0]) {
    const first = roundTransitions(states[0], firstCount, rounds), second = roundTransitions(states[1], 8 - firstCount, rounds);
    for (const a of first) for (const b of second) if (canFillPools([a, b], rounds - 1, memo)) { memo.set(key, true); return true; }
  }
  memo.set(key, false); return false;
}

export function chooseLeagueActive(unitsByPool, remaining, future, candidates, restStreak, memo, avoidDoubleRests = false) {
  const options = [];
  for (const firstCount of [4, 8, 0]) {
    const chosen = [];
    const choosePool = index => {
      if (index === 2) {
        const ids = chosen.flat(), next = { ...remaining };
        for (const id of ids) next[id]--;
        const idle = unitsByPool.flat().flat().filter(id => !ids.includes(id));
        return (avoidDoubleRests ? poolsRestFeasible(unitsByPool, next, future, idle, memo) : poolsFeasible(unitsByPool, next, future, memo)) ? ids : null;
      }
      const units = unitsByPool[index], required = units.filter(unit => remaining[unit[0]] > future || (avoidDoubleRests && unit.some(id => (restStreak[id] || 0) >= 1)));
      if (required.some(unit => remaining[unit[0]] <= 0)) return null;
      const optional = candidates.filter(unit => units.includes(unit) && !required.includes(unit));
      const start = chosen.length; chosen.push(...required);
      const choose = (position, needed) => {
        if (!needed) return choosePool(index + 1);
        if (needed < 0 || position === optional.length) return null;
        chosen.push(optional[position]); const included = choose(position + 1, needed - optional[position].length); chosen.pop();
        return included || choose(position + 1, needed);
      };
      const result = choose(0, (index === 0 ? firstCount : 8 - firstCount) - required.flat().length);
      chosen.length = start; return result;
    };
    const ids = choosePool(0);
    if (ids) {
      const rests = unitsByPool.flat().flat().filter(id => !ids.includes(id) && (restStreak[id] || 0) >= 1).length;
      const priority = candidates.reduce((sum, unit, index) => sum + (ids.includes(unit[0]) ? candidates.length - index : 0), 0);
      options.push({ ids, rests, priority });
    }
  }
  return options.sort((a, b) => a.rests - b.rests || b.priority - a.priority)[0]?.ids || null;
}

export function poolsRestFeasible(unitsByPool, remaining, rounds, restingIds = [], memo = new Map()) {
  const resting = new Set(restingIds);
  const states = unitsByPool.map(units => units.map(unit => [unit.length, remaining[unit[0]], Number(unit.some(id => resting.has(id)))]).sort((a, b) => a[0] - b[0] || b[1] - a[1] || a[2] - b[2]));
  return canAvoidConsecutiveRests(states, rounds, memo);
}

function canAvoidConsecutiveRests(states, rounds, memo) {
  if (!rounds) return states.every(state => state.every(([, n]) => n === 0));
  if (states.some(state => state.some(([, n, rest]) => n > rounds || n < Math.floor((rounds + rest) / 2)))) return false;
  const plain = states.map(state => state.map(([size, n]) => [size, n]).filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0] || b[1] - a[1]));
  if (!canFillPools(plain, rounds, memo)) return false;
  const key = `rests:${rounds}:${JSON.stringify(states)}`;
  if (memo.has(key)) return memo.get(key);
  function transitions(state, capacity) {
    const groups = [];
    for (const [size, n, rest] of state) {
      const last = groups.at(-1);
      if (last && last.size === size && last.n === n && last.rest === rest) last.count++;
      else groups.push({ size, n, rest, count: 1 });
    }
    const output = [];
    function choose(index, slots, next) {
      if (index === groups.length) { if (slots === capacity) output.push(next.sort((a, b) => a[0] - b[0] || b[1] - a[1] || a[2] - b[2])); return; }
      const { size, n, rest, count } = groups[index];
      for (let take = Math.min(n ? count : 0, Math.floor((capacity - slots) / size)); take >= (rest || n === rounds ? count : 0); take--) choose(index + 1, slots + size * take, [...next, ...Array.from({ length: take }, () => [size, n - 1, 0]), ...Array.from({ length: count - take }, () => [size, n, 1])]);
    }
    choose(0, 0, []); return output;
  }
  for (const count of [4, 8, 0]) for (const a of transitions(states[0], count)) for (const b of transitions(states[1], 8 - count)) if (canAvoidConsecutiveRests([a, b], rounds - 1, memo)) { memo.set(key, true); return true; }
  memo.set(key, false); return false;
}
