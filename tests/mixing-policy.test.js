import test from 'node:test';
import assert from 'node:assert/strict';
import { mixingCounts, minimumMixedMatches } from '../src/mixing-policy.js';
import { allocateForWindow, generateSchedule } from '../src/scheduler.js';
import { validateSession } from '../src/model.js';
import { boundedMixingPlan } from '../src/bounded-mixing-plan.js';
const seeded=value=>()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296};
const setup=(a,b)=>{const ids=Array.from({length:a+b},(_,i)=>`p${i}`);return {ids,leagues:Object.fromEntries(ids.map((id,i)=>[id,i<a?0:1])),strengths:Object.fromEntries(ids.map((id,i)=>[id,i<a?0.55:0.45]))}};
function verify(result,ids,quotas,leagues,pairs,rounds){
 validateSession({date:'2026-11-01',participantIds:ids,fixedPlayerIds:ids,startTime:'00:00',endTime:`${String(Math.floor(rounds/2)).padStart(2,'0')}:${rounds%2?'30':'00'}`,roundMinutes:30,lockedPairs:pairs,matchMap:result.matchMap},ids);
 for(const id of ids)assert.equal(Object.values(result.matchMap).filter(m=>[...m.teamA,...m.teamB].includes(id)).length,quotas[id]);
 for(const pair of pairs)for(const m of Object.values(result.matchMap))if([...m.teamA,...m.teamB].some(id=>pair.includes(id)))assert([m.teamA,m.teamB].some(team=>pair.every(id=>team.includes(id))));
 const counts=mixingCounts(result.matchMap,leagues,ids);assert.deepEqual(counts,result.mixedByPlayer);return counts;
}

test('mixing counts every participant in a mixed match, including teammates from the same group',()=>{
 const {ids,leagues}=setup(4,4);
 const counts=mixingCounts({a:{teamA:['p0','p1'],teamB:['p4','p5']},b:{teamA:['p0','p2'],teamB:['p1','p3']}},leagues,ids);
 assert.deepEqual(counts,{p0:1,p1:1,p2:0,p3:0,p4:1,p5:1,p6:0,p7:0});
});

test('unnecessary mixing is not forced when same-group matches already satisfy the objectives',()=>{
 const {ids,leagues,strengths}=setup(4,4),quotas=Object.fromEntries(ids.map(id=>[id,2]));
 const result=generateSchedule(ids,quotas,{leagues,strengths,random:seeded(73),attempts:60});
 assert.equal(result.mixedMatches,0);assert.equal(result.consecutiveRests,0);
 verify(result,ids,quotas,leagues,[],2);
});

test('one mixed outing per person can reduce fixed-opponent and partner repetition',()=>{
 const {ids,leagues,strengths}=setup(4,4),pairs=[['p0','p1']],quotas=Object.fromEntries(ids.map(id=>[id,3]));
 for(const seed of [7,73,2026]){
  const result=generateSchedule(ids,quotas,{leagues,strengths,lockedPairs:pairs,random:seeded(seed),attempts:100});
  const counts=verify(result,ids,quotas,leagues,pairs,3);
  assert(Object.values(counts).every(n=>n<=1));assert(result.mixedMatches>0);
  assert(result.partnerRepeats<2);assert.equal(result.consecutiveRests,0);
 }
});

test('six and four attendees get quotas that admit bounded mixing instead of repeatedly moving a boundary member',()=>{
 const {ids,leagues,strengths}=setup(6,4);
 for(const seed of [7,73,2026]){
  const quotas=allocateForWindow(ids,4,[],{leagues,strengths,random:seeded(seed)});
  assert(Number.isFinite(minimumMixedMatches(ids,quotas,leagues,4)));
  const result=generateSchedule(ids,quotas,{leagues,strengths,random:seeded(seed),attempts:150});
  const counts=verify(result,ids,quotas,leagues,[],4);assert(Object.values(counts).every(n=>n<=1));
  assert(Math.max(...Object.values(quotas))-Math.min(...Object.values(quotas))<=1);
 }
});

test('the group layout rejects an impossible one-per-person quota profile',()=>{
 const {ids,leagues}=setup(6,4);
 const quotas=Object.fromEntries(ids.map(id=>[id,3]));
 assert.equal(minimumMixedMatches(ids,{...quotas,p6:4,p7:4},leagues,4),1);
 assert.equal(minimumMixedMatches(ids,{...quotas,p0:4,p6:4},leagues,4),Infinity);
 assert.equal(minimumMixedMatches(ids,{...quotas,p0:4,p1:4},leagues,4),2);
});

test('bounded mixing improves rest spacing for ten upper and six lower attendees',()=>{
 const {ids,leagues,strengths}=setup(10,6),quotas=allocateForWindow(ids,4,[],{leagues,strengths,random:seeded(73)});
 const result=generateSchedule(ids,quotas,{leagues,strengths,random:seeded(73),attempts:150});
 const counts=verify(result,ids,quotas,leagues,[],4);
 assert(Object.values(counts).every(n=>n<=1));assert(result.consecutiveRests<6);assert(result.mixedMatches>0);
});

test('whole-schedule fallback handles eleven and five attendees without exceeding the mixing allowance',()=>{
 const {ids,leagues,strengths}=setup(11,5),pairs=[['p0','p1']],quotas=Object.fromEntries(ids.map(id=>[id,3]));
 const plan=boundedMixingPlan(ids,quotas,leagues,pairs,6,{random:seeded(2026),strengths});
 assert(plan);
 const result=generateSchedule(ids,quotas,{leagues,strengths,lockedPairs:pairs,plannedRounds:plan,separatePools:false,random:seeded(2026),attempts:1});
 const counts=verify(result,ids,quotas,leagues,pairs,6);
 assert(Object.values(counts).every(n=>n<=1));assert.equal(result.mixedMatches,1);
});

test('insufficient group attendance is an explicit exception and still preserves two games per person',()=>{
 const {ids,leagues,strengths}=setup(2,2),quotas=Object.fromEntries(ids.map(id=>[id,3]));
 const result=generateSchedule(ids,quotas,{leagues,strengths,random:seeded(73),attempts:40});
 const counts=verify(result,ids,quotas,leagues,[],3);assert(Object.values(counts).every(n=>n===3));
});

test('a cross-group fixed pair stays together when its unavoidable mixing exceeds one outing',()=>{
 const {ids,leagues,strengths}=setup(4,4),pairs=[['p0','p4']],quotas=Object.fromEntries(ids.map(id=>[id,3]));
 const result=generateSchedule(ids,quotas,{leagues,strengths,lockedPairs:pairs,random:seeded(73),attempts:60});
 const counts=verify(result,ids,quotas,leagues,pairs,3);assert.equal(counts.p0,3);assert.equal(counts.p4,3);
});
