import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, defaults, iqrThreshold, shiftMonth } from '../lib/engine';
import { exportCsv } from '../lib/csv';
import type { Product } from '../lib/types';
const product:Product={code:'001_',sku:'TEST',name:'Тест',multiple:12,stock:15,transit:5,category:'1',monthly:Array.from({length:33},(_,i)=>({month:shiftMonth('2024-01',i),quantity:100})),stockHistory:[],anomalies:[],transactionCount:0,negativeTransactions:0,iqrThreshold:null,issues:[],sources:[]};
const data={asOf:'2026-09-22',seasonality:{'10':1.1}};
test('uses 12 complete months, subtracts inventory then rounds upward',()=>{
  const row=calculate(product,data,{...defaults,growth:false,seasonality:false});
  assert.equal(row.baseline,100);assert.equal(row.forecast,100);assert.equal(row.order,84);
  assert.equal(row.history.length,12);assert.equal(row.history[0].month,'2025-09');assert.equal(row.history.at(-1)?.month,'2026-08');assert.equal(row.forecastMonths[0].month,'2026-10');
});
test('stock covers demand, never proposes a negative order',()=>assert.equal(calculate({...product,stock:200},data,defaults).order,0));
test('unknown inventory or multiple blocks recommendations rather than inventing zero',()=>{
  for(const patch of [{stock:null},{transit:null},{multiple:null},{multiple:0},{stock:-1},{monthly:[]}])assert.equal(calculate({...product,...patch},data,defaults).order,null);
});
test('missing monthly observations follow explicit scenario setting',()=>{
  const p={...product,monthly:product.monthly.map(m=>m.month==='2026-08'?{...m,quantity:null}:m)};
  assert.equal(calculate(p,data,{...defaults,blankAsZero:false}).baseline,100);
  assert.equal(calculate(p,data,defaults).baseline,1100/12);
});
test('negative demand is clamped; original quantity preserved',()=>{
  const p={...product,monthly:product.monthly.map(m=>({...m,quantity:-100}))},r=calculate(p,data,defaults);
  assert.equal(r.order,0);assert.equal(r.forecast,0);assert.equal(r.history[0].raw,-100);
});
test('IQR identifies extreme orders and adjusts proportional excess',()=>{
  assert.equal(iqrThreshold([10,10,10,10,10,10,10,100]),10);assert.equal(iqrThreshold([10,100]),null);
  const p={...product,anomalies:[{month:'2026-08',positive:200,excess:100,count:1}]};
  assert.equal(calculate(p,data,defaults).history.at(-1)?.regular,50);
  assert.equal(calculate(p,data,{...defaults,anomalies:false}).history.at(-1)?.regular,100);
});
test('extreme growth and seasonality are bounded and optional stockout is explicit',()=>{
  const p={...product,monthly:product.monthly.map(m=>({...m,quantity:m.month>='2026-06'?10000:100}))};
  const r=calculate(p,{...data,seasonality:{'10':100}},defaults);
  assert.equal(r.growthFactor,1.5);assert.equal(r.seasonFactor,1.3);
  const base=calculate(product,data,{...defaults,growth:false,seasonality:false});
  const compensated=calculate(product,data,{...defaults,growth:false,seasonality:false,stockoutPercent:20});
  assert.equal(compensated.forecast,base.forecast*1.2);
});
test('CSV includes parameters and neutralizes spreadsheet formulas',()=>{
  const row=calculate({...product,name:'=HYPERLINK("x")'},data,defaults),csv=exportCsv([row],defaults,data.asOf);
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes('Stockout сценарий %'));assert.ok(csv.includes('001_'));
});
