import test from 'node:test';
import assert from 'node:assert/strict';
import { leaguesForSession } from '../src/leagues.js';
import { initialStrengths } from '../src/ratings.js';
import { planLeaguePools, poolFeasible, poolsFeasible, poolsRestFeasible } from '../src/schedule-pools.js';
import { allocateForWindow, generateSchedule } from '../src/scheduler.js';
import { validateSession } from '../src/model.js';
import baseline from '../data/strength-baseline.json' with { type: 'json' };
const seeded = value => () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
const ids = Array.from({length:14},(_,i)=>`p${i}`);
const prior = { ratings: Object.fromEntries(ids.map((id,i)=>[id,i<8?0.8:0.2])) };
const match = (date, win, round=1, overrides={}) => ({date,round,court:1,teamA:['p8','p9'],teamB:['p10','p11'],fixedPlayerIds:['p8','p9','p10','p11'],scoreA:win?6:3,scoreB:win?3:6,outcome:win?'teamA':'teamB',...overrides});
const sample = (dates=['2026-10-04','2026-10-11','2026-10-18']) => dates.flatMap((date,i)=>Array.from({length:4},(_,round)=>match(date,i*4+round<8,round+1)));

test('initial internal groups preserve supplied steps and keep equal initial ratings together',()=>{
 const members=baseline.groups.flat(), strengths=initialStrengths(members,baseline);
 const result=leaguesForSession([],members,baseline,'2026-11-01');
 assert.deepEqual(members.filter(id=>result.leagues[id]===0),baseline.groups.slice(0,4).flat());
 assert.equal(new Set(baseline.groups[4].map(id=>result.leagues[id])).size,1);
 assert(result.boundary>strengths.gdr006&&result.boundary<strengths.gdr013);
});

test('12 matches across 3 meetings can promote; one day and insufficient samples cannot',()=>{
 const records=sample(), initial=leaguesForSession([],ids,prior,'2026-11-01');
 assert.equal(initial.leagues.p8,1);
 const promoted=leaguesForSession(records,ids,prior,'2026-11-01');
 assert.equal(promoted.leagues.p8,0);
 assert.equal(promoted.changes.find(change=>change.id==='p8').date,'2026-10-18');
 assert.equal(leaguesForSession(records.slice(0,11),ids,prior,'2026-11-01').leagues.p8,1);
 assert.equal(leaguesForSession(records.map(row=>({...row,date:'2026-10-18'})),ids,prior,'2026-11-01').leagues.p8,1);
 assert.deepEqual(leaguesForSession([...records].reverse(),ids,prior,'2026-11-01'),promoted);
});

test('group changes require fresh evidence; a few losses after promotion do not undo it',()=>{
 const records=sample(), losses=Array.from({length:4},(_,r)=>match('2026-10-25',false,r+1));
 assert.equal(leaguesForSession([...records,...losses],ids,prior,'2026-11-01').leagues.p8,0);
 const more=['2026-11-01','2026-11-08'].flatMap(day=>Array.from({length:4},(_,r)=>match(day,false,r+1)));
 const result=leaguesForSession([...records,...losses,...more],ids,prior,'2026-11-15');
 assert.equal(result.leagues.p8,1);
 assert.equal(result.changes.filter(change=>change.id==='p8').length,2);
});

test('promotion uses the displayed win-rate definition; draws do not count as half a win',()=>{
 const records=sample().map((row,i)=>i>=6&&i<10?{...row,scoreA:6,scoreB:6,outcome:'draw'}:row);
 assert.equal(leaguesForSession(records,ids,prior,'2026-11-01').leagues.p8,1);
});

test('old, future, unscored and unofficial results cannot cause group movement',()=>{
 const original=leaguesForSession([],ids,prior,'2026-11-01');
 for(const records of [sample(['2026-04-05','2026-04-12','2026-04-19']),sample(['2026-11-01','2026-11-08','2026-11-15']),sample().map(row=>({...row,fixedPlayerIds:['p8','p9','p10']})),sample().map(row=>({...row,scoreA:-1}))]) assert.deepEqual(leaguesForSession(records,ids,prior,'2026-11-01'),original);
 const history=[{kind:'individual-aggregate',period:'2026-H2',cutoff:'2026-10-18',rows:[{playerId:'p8',stats:{games:40,wins:40,losses:0,draws:0}}]}];
 assert.deepEqual(leaguesForSession([],ids,prior,'2026-11-01',{history}),original);
 assert.equal(leaguesForSession(sample(['2026-09-06','2026-09-13','2026-09-20']),ids,prior,'2026-11-01').leagues.p8,0);
});

test('sparse attendance and wins carried by much stronger partners do not trigger promotion',()=>{
 const dates=['2026-10-04','2026-10-11','2026-10-18','2026-10-25','2026-11-01','2026-11-08','2026-11-15','2026-11-22'];
 const sessions=dates.map(date=>({date,participantIds:ids,fixedPlayerIds:ids,matchMap:{m:{}}}));
 assert.equal(leaguesForSession(sample([dates[0],dates[4],dates[7]]),ids,prior,'2026-11-29',{sessions}).leagues.p8,1);
 const carried=sample().map(row=>({...row,teamA:['p8','p0'],fixedPlayerIds:['p8','p0','p10','p11']}));
 assert.equal(leaguesForSession(carried,ids,prior,'2026-11-01').leagues.p8,1);
});

function verify(result, participants, quotas, lockedPairs, rounds, guests={}) {
 const members=participants.filter(id=>!Object.hasOwn(guests,id));
 validateSession({date:'2026-11-01',startTime:'00:00',endTime:`${String(Math.floor(rounds/2)).padStart(2,'0')}:${rounds%2?'30':'00'}`,roundMinutes:30,participantIds:participants,fixedPlayerIds:members,guests,lockedPairs,matchMap:result.matchMap},members);
 for(const id of participants) assert.equal(Object.values(result.matchMap).filter(m=>[...m.teamA,...m.teamB].includes(id)).length,quotas[id]);
 for(const pair of lockedPairs) for(const m of Object.values(result.matchMap)) if([...m.teamA,...m.teamB].some(id=>pair.includes(id))) assert([m.teamA,m.teamB].some(team=>pair.every(id=>team.includes(id))));
}

test('14 members play within their internal group, with fair quotas and no consecutive rests',()=>{
 const members=baseline.groups.flat(),strengths=initialStrengths(members,baseline),{leagues}=leaguesForSession([],members,baseline,'2026-11-01');
 for(const rounds of [4,6]) {
  const plan=planLeaguePools(members,rounds,[],{leagues,strengths,random:seeded(73)});
  assert.equal(plan.moved,0);
  const result=generateSchedule(members,plan.quotas,{leagues,strengths,random:seeded(73),attempts:40});
  verify(result,members,plan.quotas,[],rounds);
  assert.equal(result.pooled,true);assert.equal(result.mixedMatches,0);assert.equal(result.consecutiveRests,0);
  assert(Math.max(...Object.values(plan.quotas))-Math.min(...Object.values(plan.quotas))<=1);
 }
});

test('promoted members actually play in the upper group when its size grows to ten',()=>{
 const {leagues}=leaguesForSession(sample(),ids,prior,'2026-11-01');
 const plan=planLeaguePools(ids,6,[],{leagues,strengths:prior.ratings,random:seeded(2026)});
 assert.equal(plan.moved,0);
 assert(plan.pools[0].includes('p8')&&plan.pools[0].includes('p9'));
 const result=generateSchedule(ids,plan.quotas,{leagues,strengths:prior.ratings,random:seeded(2026),attempts:40});
 verify(result,ids,plan.quotas,[],6);
 assert.equal(result.mixedMatches,0);
  assert.equal(result.consecutiveRests,0);
 assert(Object.values(result.matchMap).some(match=>match.round===1));
 const counts=Object.values(plan.quotas);assert(Math.max(...counts)-Math.min(...counts)<=1);
});

test('mixed fixed pairs and guest slots remain intact without leaking group fields into sessions',()=>{
 const strengths={...prior.ratings,guest001:0.65,guest002:0.65},participants=[...ids,'guest001','guest002'];
 const guests={guest001:{name:'손님1'},guest002:{name:'손님2'}};
 const leagues={...leaguesForSession([],ids,prior,'2026-11-01').leagues,guest001:0,guest002:0};
 const pairs=[['p0','p8'],['p1','p9']];
 const quotas=allocateForWindow(participants,6,pairs,{leagues,strengths,random:seeded(2026)});
 const result=generateSchedule(participants,quotas,{leagues,strengths,lockedPairs:pairs,random:seeded(2026),attempts:40});
 verify(result,participants,quotas,pairs,6,guests);
});

test('small crowds and manual quotas fall back without splitting fixed pairs',()=>{
 for(const count of [4,6,7,8,9,10,12,13,14,16,18,20,24,32]) for(const rounds of [4,6]) {
  if(rounds*(count>=8?8:4)<count*2)continue;
  const participants=Array.from({length:count},(_,i)=>`p${i}`),pairs=[participants.slice(0,2)];
  const leagues=Object.fromEntries(participants.map((id,i)=>[id,i<Math.floor(count/2)?0:1]));
  const strengths=Object.fromEntries(participants.map((id,i)=>[id,1-i/count]));
  const quotas=allocateForWindow(participants,rounds,pairs,{leagues,strengths,random:seeded(count)});
  const result=generateSchedule(participants,quotas,{leagues,strengths,lockedPairs:pairs,random:seeded(count),attempts:40});
  verify(result,participants,quotas,pairs,rounds);
  assert(Math.max(...Object.values(quotas))-Math.min(...Object.values(quotas))<=1);
 }
 const participants=ids.slice(0,10),leagues=Object.fromEntries(participants.map((id,i)=>[id,i<6?0:1]));
 const quotas=Object.fromEntries(participants.map((id,i)=>[id,i<8?3:4]));
 const result=generateSchedule(participants,quotas,{leagues,random:seeded(26),attempts:40});
 verify(result,participants,quotas,[],4);
});

test('nine attendees give the fixed pair every round because only one person can rest',()=>{
 const participants=ids.slice(0,9),pairs=[['p0','p1']];
 for(const rounds of [4,6])for(const seed of [7,73,2026]){
  const leagues=Object.fromEntries(participants.map((id,i)=>[id,i<4?0:1]));
  const quotas=allocateForWindow(participants,rounds,pairs,{leagues,random:seeded(seed)});
  assert.equal(quotas.p0,rounds);assert.equal(quotas.p1,rounds);
  const result=generateSchedule(participants,quotas,{leagues,lockedPairs:pairs,random:seeded(seed),attempts:40});
  verify(result,participants,quotas,pairs,rounds);
 }
});

function bruteFeasible(units, quotas, rounds, capacity) {
 const candidates=[];
 for(let mask=0;mask<2**units.length;mask++){const chosen=units.filter((_,i)=>mask&(1<<i));if(chosen.flat().length===capacity)candidates.push(chosen);}
 const memo=new Map();
 function search(remaining,n) {
  if(!n)return Object.values(remaining).every(v=>v===0);
  const key=n+':'+JSON.stringify(remaining);if(memo.has(key))return memo.get(key);
  for(const chosen of candidates)if(chosen.every(unit=>remaining[unit[0]]>0)){const next={...remaining};for(const id of chosen.flat())next[id]--;if(search(next,n-1)){memo.set(key,true);return true;}}
  memo.set(key,false);return false;
 }
 return search(quotas,rounds);
}

test('pool feasibility agrees with independent exhaustive round combinations',()=>{
 const random=seeded(73);
 for(const capacity of [4,8])for(let count=4;count<=10;count++)for(let pairCount=0;pairCount<=Math.floor(count/2);pairCount++)for(let run=0;run<8;run++){
  const participants=Array.from({length:count},(_,i)=>`p${i}`),paired=participants.slice(0,pairCount*2);
  const units=[...Array.from({length:pairCount},(_,i)=>participants.slice(i*2,i*2+2)),...participants.filter(id=>!paired.includes(id)).map(id=>[id])];
  const quotas=Object.assign({},...units.map(unit=>Object.fromEntries(unit.map(id=>[id,0]))));
  for(const unit of units){const n=1+Math.floor(random()*3);for(const id of unit)quotas[id]=n;}
  const rounds=Object.values(quotas).reduce((a,b)=>a+b,0)/capacity;
  if(!Number.isInteger(rounds))continue;
  assert.equal(poolFeasible(units,quotas,rounds,new Map(),capacity),bruteFeasible(units,quotas,rounds,capacity),JSON.stringify({units,quotas,rounds,capacity}));
 }
});

test('shared-court feasibility agrees with exhaustive grouped round combinations',()=>{
 const random=seeded(2026);
 for(const count of [8,9,10,11,12])for(let run=0;run<20;run++){
  const members=Array.from({length:count},(_,i)=>`p${i}`),cut=Math.min(count-4,4+run%3),pools=[members.slice(0,cut),members.slice(cut)];
  const fixedPairs=run%2?pools.map(pool=>pool.slice(0,2)):[],paired=new Set(fixedPairs.flat()),units=pools.map(pool=>[...fixedPairs.filter(pair=>pool.includes(pair[0])),...pool.filter(id=>!paired.has(id)).map(id=>[id])]);
  const quotas=Object.fromEntries(members.map(id=>[id,1+Math.floor(random()*3)]));for(const [a,b]of fixedPairs)quotas[b]=quotas[a];
  const rounds=Object.values(quotas).reduce((a,b)=>a+b,0)/8;
  if(!Number.isInteger(rounds))continue;
  const roundsAllowed=[];
  for(let mask=0;mask<2**count;mask++){
   const active=members.filter((_,i)=>mask&(1<<i));
   if(active.length===8&&active.filter(id=>pools[0].includes(id)).length%4===0&&fixedPairs.every(([a,b])=>active.includes(a)===active.includes(b)))roundsAllowed.push(active);
  }
  const memo=new Map();
  const search=(remaining,n)=>{
   if(!n)return Object.values(remaining).every(value=>!value);
   const key=n+':'+JSON.stringify(remaining);if(memo.has(key))return memo.get(key);
   for(const active of roundsAllowed)if(active.every(id=>remaining[id]>0)){const next={...remaining};for(const id of active)next[id]--;if(search(next,n-1)){memo.set(key,true);return true;}}
   memo.set(key,false);return false;
  };
  assert.equal(poolsFeasible(units,quotas,rounds),search(quotas,rounds),JSON.stringify({pools,quotas,rounds}));
  const restMemo=new Map();
  const searchRest=(remaining,n,resting=[])=>{
   if(!n)return Object.values(remaining).every(value=>!value);
   const key=n+':'+JSON.stringify([remaining,resting]);if(restMemo.has(key))return restMemo.get(key);
   for(const active of roundsAllowed)if(active.every(id=>remaining[id]>0)&&resting.every(id=>active.includes(id))){const next={...remaining};for(const id of active)next[id]--;if(searchRest(next,n-1,members.filter(id=>!active.includes(id)))){restMemo.set(key,true);return true;}}
   restMemo.set(key,false);return false;
  };
  assert.equal(poolsRestFeasible(units,quotas,rounds),searchRest(quotas,rounds),JSON.stringify({pools,quotas,rounds}));
 }
});
