import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadData } from '../lib/importer';
import { calculateAll, defaults } from '../lib/engine';
test('real local Excel import: confirmed SKU mapping and safe recommendations',{skip:!existsSync('data/raw/MOQ SystemElectric (2).xlsx')},async()=>{
  const data=await loadData();
  assert.equal(data.files.length,6);assert.equal(data.asOf,'2026-09-22');assert.equal(data.transactionCount,77312);
  for(const [sku,code,multiple,stock,september] of [['ATN000343','300200428_',10,1118,81],['BLNZA000011','300200330_',8,9,10],['U734M','130300028_',140,8,187]] as const){
    const p=data.products.find(p=>p.sku===sku);assert.ok(p);assert.equal(p.code,code);assert.equal(p.multiple,multiple);assert.equal(p.stock,stock);assert.equal(p.transit,0);assert.equal(p.monthly.find(m=>m.month==='2026-09')?.quantity,september);
  }
  const rows=calculateAll(data,defaults);assert.equal(new Set(rows.map(r=>r.code)).size,rows.length);
  for(const r of rows){assert.ok(Number.isFinite(r.forecast));assert.ok(r.forecast>=0);if(r.order!==null){assert.ok(r.multiple);assert.equal(r.order%r.multiple,0);assert.ok(r.order>=0);}}
  assert.ok(rows.some(r=>r.urgency==='review'));assert.ok(rows.some(r=>r.anomalyCount>0));
  console.log(`Imported ${data.products.length} products; ${rows.filter(r=>(r.order??0)>0).length} recommended orders; ${rows.filter(r=>r.urgency==='review').length} require review.`);
});
