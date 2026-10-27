import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceLeaguesForSession, PERSONAL_SEED_WEIGHT, HALF_YEAR_SEED_WEIGHT } from '../src/attendance-leagues.js';
import { initialStrengths } from '../src/ratings.js';
import { allocateForWindow, generateSchedule } from '../src/scheduler.js';
import { mixingCounts } from '../src/mixing-policy.js';
import { validateSession } from '../src/model.js';
import baseline from '../data/strength-baseline.json' with { type: 'json' };
import players from '../data/players.json' with { type: 'json' };
const members=baseline.groups.flat(),date='2026-11-01';
const neutral=Array.from({length:8},(_,i)=>({id:`p${i}`,name:`선수${i}`}));
const game=(day='2026-10-11',outcome='teamA')=>({date:day,round:1,court:1,teamA:['p0','p1'],teamB:['p6','p7'],fixedPlayerIds:['p0','p1','p6','p7'],scoreA:outcome==='teamB'?3:6,scoreB:outcome==='teamA'?3:6,outcome});
const seeded=value=>()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296};

test('the personal seed is the majority component and an empty ranking remains neutral',()=>{
 const result=attendanceLeaguesForSession([],players,baseline,date,{participantIds:members});
 const priors=initialStrengths(players.map(p=>p.id),baseline);
 assert.equal(PERSONAL_SEED_WEIGHT,0.75);assert.equal(HALF_YEAR_SEED_WEIGHT,0.25);
 for(const id of members)assert.equal(result.seedScores[id],0.75*priors[id]+0.25*0.5);
 assert(result.cut>=4&&members.length-result.cut>=4);
});

test('eight attendees who all belonged to the old upper group are divided again',()=>{
 const attendees=baseline.groups.slice(0,4).flat();
 const result=attendanceLeaguesForSession([],players,baseline,date,{participantIds:attendees});
 assert.equal(result.cut,4);
 assert.equal(Object.values(result.leagues).filter(value=>value===0).length,4);
 assert.equal(Object.values(result.leagues).filter(value=>value===1).length,4);
 assert.deepEqual(result.order.slice(0,4),attendees.slice(0,4).sort((a,b)=>result.order.indexOf(a)-result.order.indexOf(b)));
});

test('missing stronger members can move a former lower member into the daily upper group without changing their seed',()=>{
 const all=attendanceLeaguesForSession([],players,baseline,date,{participantIds:members});
 const attendees=members.slice(-8),today=attendanceLeaguesForSession([],players,baseline,date,{participantIds:attendees});
 assert.equal(today.cut,4);
 assert(attendees.some(id=>baseline.groups.slice(-2).flat().includes(id)&&today.leagues[id]===0));
 for(const id of attendees)assert.equal(today.seedScores[id],all.seedScores[id]);
 assert.deepEqual(Object.keys(today.leagues).sort(),[...attendees].sort());
 const reversed=attendanceLeaguesForSession([],players,baseline,date,{participantIds:[...attendees].reverse()});
 assert.deepEqual(today.leagues,reversed.leagues);
});

test('half-year ranking orders equal personal weights and sparse results have less influence',()=>{
 const one=attendanceLeaguesForSession([game()],neutral,{},date);
 const many=attendanceLeaguesForSession(Array(24).fill(game()),neutral,{},date);
 assert(one.seedScores.p0>0.5&&one.seedScores.p0-0.5<0.002);
 assert(many.seedScores.p0>one.seedScores.p0);
 assert(many.seedScores.p0>many.seedScores.p6);
 const draw=attendanceLeaguesForSession(Array(24).fill(game('2026-10-11','draw')),neutral,{},date);
 assert(Object.values(draw.seedScores).every(value=>value===0.5));
});

test('a large personal difference remains stronger than the secondary ranking signal',()=>{
 const ratings=Object.fromEntries(neutral.map((p,i)=>[p.id,i<2?0.9:i>5?0.1:0.5]));
 const result=attendanceLeaguesForSession(Array(100).fill(game('2026-10-11','teamB')),neutral,{ratings},date);
 assert(result.seedScores.p0>result.seedScores.p6);
});

test('only verified pre-meeting H2 evidence can influence the seed',()=>{
 const empty=attendanceLeaguesForSession([],neutral,{},date);
 const bad=[game('2026-06-28'),game(date),game('2026-11-08'),{...game(),scoreA:-1},{...game(),fixedPlayerIds:['p0','p1','p6']}];
 assert.deepEqual(attendanceLeaguesForSession(bad,neutral,{},date),empty);
 const snapshot={id:'h2',kind:'individual-aggregate',aggregationRole:'period-baseline',contributesToLiveRanking:true,datePrecision:'day',period:'2026-H2',periodStart:'2026-07-01',cutoff:'2026-10-18',rows:[{playerId:'p0',stats:{wins:100,draws:0,losses:0,scored:600,conceded:200}},{playerId:'p1',stats:{wins:50,draws:0,losses:50,scored:500,conceded:400}}]};
 const good=attendanceLeaguesForSession([],neutral,{},date,{history:[snapshot]});assert(good.seedScores.p0>good.seedScores.p1);
 for(const history of [[{...snapshot,cutoff:date}],[{...snapshot,cutoff:'2026-06-28',periodStart:'2026-01-01'}],[{...snapshot,contributesToRatings:false}],[{...snapshot,rows:snapshot.rows.map(row=>({...row,issues:['identity-review']}))}]])assert.deepEqual(attendanceLeaguesForSession([],neutral,{},date,{history}),empty);
});

test('covered actual matches do not count twice in the half-year rank',()=>{
 const snapshot={id:'h2',kind:'individual-aggregate',aggregationRole:'period-baseline',contributesToLiveRanking:true,datePrecision:'day',period:'2026-H2',periodStart:'2026-07-01',cutoff:'2026-10-18',rows:['p0','p1','p6','p7'].map(id=>({playerId:id,stats:{wins:['p0','p1'].includes(id)?24:0,draws:0,losses:['p0','p1'].includes(id)?0:24,scored:100,conceded:80}}))};
 const before=attendanceLeaguesForSession([],neutral,{},date,{history:[snapshot]});
 const after=attendanceLeaguesForSession(Array(12).fill(game()),neutral,{},date,{history:[snapshot]});
 assert.deepEqual(before.seedScores,after.seedScores);
});

test('guest seed stays above neutral and fewer than eight attendees use one group',()=>{
 const participants=[...members.slice(0,7),'guest001'];
 const result=attendanceLeaguesForSession([],players,baseline,date,{participantIds:participants,guests:{guest001:{name:'손님'}}});
 assert.equal(result.seedScores.guest001,0.65);assert.equal(result.cut,4);
 const small=attendanceLeaguesForSession([],players,baseline,date,{participantIds:members.slice(-6)});
 assert(Object.values(small.leagues).every(value=>value===0));
 assert.throws(()=>attendanceLeaguesForSession([],players,baseline,date,{participantIds:['unknown']}),/명단/);
});

test('daily grouping integrates with time, exact quotas and the one-outing mixing budget',()=>{
 for(const participants of [members.slice(0,8),members.slice(-8),members,members.slice(2)]){
  const {leagues,seedScores:strengths}=attendanceLeaguesForSession([],players,baseline,date,{participantIds:participants});
  const quotas=allocateForWindow(participants,4,[],{leagues,strengths,random:seeded(73)});
  const result=generateSchedule(participants,quotas,{leagues,strengths,random:seeded(73),attempts:80});
  validateSession({date,participantIds:participants,fixedPlayerIds:participants,startTime:'19:00',endTime:'21:00',roundMinutes:30,matchMap:result.matchMap},players.map(p=>p.id));
  assert(Object.values(mixingCounts(result.matchMap,leagues,participants)).every(n=>n<=1));
  for(const id of participants)assert.equal(Object.values(result.matchMap).filter(m=>[...m.teamA,...m.teamB].includes(id)).length,quotas[id]);
 }
});

test('fourteen-member meetings include mixed games in both normal windows without extra rests',()=>{
 const {leagues,seedScores:strengths}=attendanceLeaguesForSession([],players,baseline,date,{participantIds:members});
 for(const rounds of [4,6])for(const seed of [7,73,2026]){
  const quotas=allocateForWindow(members,rounds,[],{leagues,strengths,random:seeded(seed)});
  const result=generateSchedule(members,quotas,{leagues,strengths,random:seeded(seed),attempts:80});
  const counts=mixingCounts(result.matchMap,leagues,members);
  assert(result.mixedMatches>=2);assert.equal(result.consecutiveRests,0);
  assert(Object.values(counts).every(n=>n<=1));
  assert(Object.values(counts).filter(n=>n===1).length>=8);
 }
});
