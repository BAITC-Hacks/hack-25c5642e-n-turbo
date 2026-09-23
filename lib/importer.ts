import ExcelJS from 'exceljs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { iqrThreshold, shiftMonth } from './engine';
import type { AppDataset, Product } from './types';

function text(value: ExcelJS.CellValue): string {
  if (value===null||value===undefined) return '';
  if (typeof value==='object') {
    if ('result' in value) return text(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map(t=>t.text).join('').trim();
    if ('text' in value) return String(value.text).trim();
  }
  return String(value).trim();
}
function num(value: ExcelJS.CellValue): number|null {
  if (value!==null && typeof value==='object' && 'result' in value) return num(value.result as ExcelJS.CellValue);
  if (typeof value==='number') return Number.isFinite(value)?value:null;
  if (typeof value==='string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
function assertHeader(sheet: ExcelJS.Worksheet, address: string, expected: string) {
  if(text(sheet.getCell(address).value)!==expected) throw new Error(`${sheet.name}!${address}: ожидалась колонка «${expected}». Проверьте структуру файла.`);
}
let cached: {fingerprint:string; promise:Promise<AppDataset>}|undefined;
export async function loadData(): Promise<AppDataset> {
  const directory=path.join(process.cwd(),'data','raw');
  const names=(await readdir(directory)).filter(n=>/\.xlsx$/i.test(n)&&!n.startsWith('~$')).sort();
  const fingerprint=(await Promise.all(names.map(async n=>{const s=await stat(path.join(directory,n));return `${n}:${s.size}:${s.mtimeMs}`;}))).join('|');
  if(cached?.fingerprint===fingerprint) return cached.promise;
  const promise=importData(directory,names);
  cached={fingerprint,promise};
  try { return await promise; } catch(e) { if(cached?.promise===promise) cached=undefined; throw e; }
}
async function importData(directory:string,names:string[]):Promise<AppDataset> {
  const products=new Map<string,Product>(), warnings:string[]=[], files:AppDataset['files']=[];
  const transactions=new Map<string,{month:string;quantity:number}[]>();
  let asOf='', transactionCount=0, missingQty=0, ignoredOrders=0;
  const seasonYears:{year:number;values:(number|null)[]}[]=[];
  const get=(code:string,name='')=>{
    if(!products.has(code)) products.set(code,{code,sku:'',name,multiple:null,stock:null,transit:null,category:null,monthly:[],stockHistory:[],anomalies:[],transactionCount:0,negativeTransactions:0,iqrThreshold:null,issues:[],sources:[]});
    const p=products.get(code)!; if(!p.name&&name)p.name=name; return p;
  };
  const definitions=[
    {kind:'moq',prefix:'MOQ '}, {kind:'sales',prefix:'Ежемесячные продажи'},
    {kind:'summary',prefix:'Товар в пути'}, {kind:'stock',prefix:'Ежемесячные остатки'},
    {kind:'transactions',prefix:'Динамика продаж'}, {kind:'season',prefix:'Сезонность'}
  ];
  for(const {kind,prefix} of definitions){
    const matches=names.filter(n=>n.startsWith(prefix));
    if(matches.length!==1) throw new Error(`В data/raw нужен ровно один файл «${prefix}*.xlsx». Найдено: ${matches.length}.`);
    const filename=matches[0], workbook=new ExcelJS.Workbook();
    // Stream cell data only: the supplier's drawing relationships cannot be
    // reconciled by the full ExcelJS workbook loader. Never write the source.
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(path.join(directory,filename), {
      entries: 'ignore', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'cache', worksheets: 'emit',
    });
    for await (const sourceSheet of reader) {
      // ExcelJS exposes worksheet.name at runtime but omits it in reader types.
      const target = workbook.addWorksheet((sourceSheet as unknown as { name: string }).name);
      for await (const row of sourceSheet) target.getRow(row.number).values = row.values;
    }
    files.push({name:filename,sheets:workbook.worksheets.map(s=>s.name)});
    const sheet=kind==='summary'?workbook.getWorksheet('TDSheet'):workbook.worksheets[0];
    if(!sheet)throw new Error(`Не найден лист в ${filename}`);
    const seen=new Set<string>();
    if(kind==='moq') {assertHeader(sheet,'C1','Номенклатура.Код');assertHeader(sheet,'D1','Артикул');assertHeader(sheet,'E1','Кратность');}
    if(kind==='sales') {assertHeader(sheet,'B1','Номенклатура.Код');assertHeader(sheet,'C1','Артикул');assertHeader(sheet,'E1','янв. 2024');assertHeader(sheet,'AK1','сент. 2026');}
    if(kind==='summary') {assertHeader(sheet,'C2','Код 1с');assertHeader(sheet,'AZ2','Свободный остаток');assertHeader(sheet,'BC2','СЭ в пути 24.09');}
    if(kind==='stock') assertHeader(sheet,'C1','Номенклатура.Код');
    if(kind==='transactions') {assertHeader(sheet,'D1','Код');assertHeader(sheet,'H1','Количество');}
    if(kind==='season'){
      assertHeader(sheet,'A3','год');
      for(let r=4;r<=6;r++)seasonYears.push({year:num(sheet.getCell(r,1).value)??0,values:Array.from({length:12},(_,m)=>num(sheet.getCell(r,m+2).value))});
      continue;
    }
    const codeCol=kind==='sales'?2:kind==='transactions'?4:3;
    const first=kind==='transactions'?2:kind==='stock'?4:3;
    sheet.eachRow((row,r)=>{
      if(r<first)return;
      const code=text(row.getCell(codeCol).value); if(!code)return;
      if(kind!=='transactions'&&seen.has(code))throw new Error(`Дублирующийся Код 1С ${code} в ${filename}:${r}`);
      seen.add(code);
      const nameCol=kind==='sales'?1:kind==='summary'?4:kind==='transactions'?5:2;
      const p=get(code,text(row.getCell(nameCol).value));
      if(!p.sources.includes(filename))p.sources.push(filename);
      if(kind==='moq'||kind==='sales'||kind==='summary'){
        const sku=text(row.getCell(kind==='moq'?4:kind==='sales'?3:2).value);
        if(p.sku&&sku&&p.sku!==sku)throw new Error(`Конфликт артикула для ${code}: ${p.sku} / ${sku}`);
        if(sku)p.sku=sku;
      }
      if(kind==='moq')p.multiple=num(row.getCell(5).value);
      if(kind==='sales'){
        p.monthly=Array.from({length:33},(_,m)=>({month:shiftMonth('2024-01',m),quantity:num(row.getCell(m+5).value)}));
        if(p.multiple!==num(row.getCell(4).value))p.issues.push('Кратность месячного отчёта отличается: использован MOQ-файл.');
      }
      if(kind==='summary'){
        p.stock=num(row.getCell(52).value);p.transit=num(row.getCell(55).value);p.category=text(row.getCell(5).value)||null;
        const salesSep=p.monthly.find(m=>m.month==='2026-09')?.quantity, summarySep=num(row.getCell(41).value);
        if(salesSep!==undefined&&(salesSep??0)!==(summarySep??0))p.issues.push('Сентябрь в TDSheet расходится с месячным отчётом. Использован месячный отчёт.');
      }
      if(kind==='stock')p.stockHistory=Array.from({length:33},(_,m)=>({month:shiftMonth('2024-01',m),quantity:num(row.getCell(m+5).value)}));
      if(kind==='transactions'){
        const date=text(row.getCell(1).value), match=date.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
        if(!match)throw new Error(`Не распознана дата ${filename}:${r}`);
        const iso=`${match[3]}-${match[2]}-${match[1]}`;if(iso>asOf)asOf=iso;
        transactionCount++;p.transactionCount++;
        const quantity=num(row.getCell(8).value), doc=text(row.getCell(3).value);
        if(quantity===null)missingQty++;
        if(quantity!==null&&quantity<0)p.negativeTransactions++;
        if(!doc.startsWith('Расходная накладная')){ignoredOrders++;return;}
        if(quantity!==null&&quantity>0){
          if(!transactions.has(code))transactions.set(code,[]);
          transactions.get(code)!.push({month:iso.slice(0,7),quantity});
        }
      }
    });
  }
  if(!asOf)throw new Error('Не удалось определить дату данных из истории операций.');
  const seasonality:Record<string,number>={};
  const completeYears=seasonYears.filter(y=>y.year<Number(asOf.slice(0,4))&&y.values.every(v=>v!==null&&v>=0));
  for(let m=0;m<12;m++){
    const indices=completeYears.map(y=>{const average=y.values.reduce<number>((s,v)=>s+(v??0),0)/12;return average>0?y.values[m]!/average:1;});
    seasonality[String(m+1).padStart(2,'0')]=indices.length?indices.reduce((s,v)=>s+v,0)/indices.length:1;
  }
  const skuCodes=new Map<string,string>();
  for(const p of products.values()){
    if(p.sku){const existing=skuCodes.get(p.sku);if(existing&&existing!==p.code)throw new Error(`Артикул ${p.sku} соответствует нескольким кодам.`);skuCodes.set(p.sku,p.code);}
    if(!p.sku)p.issues.push('Артикул отсутствует в справочниках; показан Код 1С.');
    const points=(transactions.get(p.code)??[]).filter(t=>t.month<asOf.slice(0,7)&&t.month>=shiftMonth(asOf.slice(0,7),-24));
    p.iqrThreshold=iqrThreshold(points.map(t=>t.quantity));
    const months=new Map<string,{month:string;positive:number;excess:number;count:number}>();
    for(const t of points){
      if(!months.has(t.month))months.set(t.month,{month:t.month,positive:0,excess:0,count:0});
      const a=months.get(t.month)!;a.positive+=t.quantity;
      if(p.iqrThreshold!==null&&t.quantity>p.iqrThreshold){a.excess+=t.quantity-p.iqrThreshold;a.count++;}
    }
    p.anomalies=[...months.values()];
    if(p.negativeTransactions)p.issues.push(`${p.negativeTransactions} отрицательных операций исключены из IQR; знак месячных продаж обработан отдельно.`);
  }
  warnings.push('AP/AQ и коэффициенты товарной сводки не используются в прогнозе.');
  warnings.push(`${missingQty} операций без количества; ${ignoredOrders} строк заказов покупателей исключены из IQR.`);
  warnings.push('Lead time, customer ID, минимальный заказ и интервалы stockout отсутствуют.');
  warnings.push('Общая сезонность рассчитана по полным 2024–2025 годам. Единица агрегированных продаж не подтверждена; применяется как опциональный общий индекс.');
  return {products:[...products.values()],asOf,loadedAt:new Date().toISOString(),files,warnings,transactionCount,seasonality};
}
