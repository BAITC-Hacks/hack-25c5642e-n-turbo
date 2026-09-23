import type { AppDataset, Product, Recommendation, Settings } from './types';
export const defaults: Settings = { horizon: 1, growth: true, seasonality: true, anomalies: true, blankAsZero: true, stockoutPercent: 0 };
export const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));
export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * p, lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}
export function iqrThreshold(values: number[]): number | null {
  const sorted = values.filter(v => Number.isFinite(v) && v > 0).sort((a,b) => a-b);
  if (sorted.length < 8) return null;
  const q1 = quantile(sorted, .25), q3 = quantile(sorted, .75);
  return q3 + 1.5 * (q3 - q1);
}
export function shiftMonth(month: string, offset: number): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, m - 1 + offset, 1));
  return date.toISOString().slice(0,7);
}
export function calculate(product: Product, data: Pick<AppDataset, 'asOf' | 'seasonality'>, input: Settings): Recommendation {
  const settings = { ...input, horizon: Math.round(clamp(Number(input.horizon) || 1, 1, 6)), stockoutPercent: clamp(Number(input.stockoutPercent) || 0, 0, 50) };
  const current = data.asOf.slice(0,7), start = shiftMonth(current,-12);
  const notes = [...product.issues];
  const history = product.monthly.filter(m => m.month < current && m.month >= start).map(m => {
    const cleaned = Math.max(0, m.quantity ?? 0), anomaly = product.anomalies.find(a => a.month === m.month);
    const ratio = settings.anomalies && anomaly && anomaly.positive > 0 ? clamp(1 - anomaly.excess / anomaly.positive, 0, 1) : 1;
    return { month: m.month, raw: m.quantity, cleaned, regular: cleaned * ratio, assumedZero: m.quantity === null && settings.blankAsZero };
  });
  const usable = history.filter(m => m.raw !== null || settings.blankAsZero);
  const baseline = usable.length ? usable.reduce((s,m) => s+m.regular,0)/usable.length : 0;
  const cleanAt = (month: string): number | null => {
    const value = product.monthly.find(m => m.month === month);
    if (!value || (value.quantity === null && !settings.blankAsZero)) return null;
    const a = product.anomalies.find(a => a.month === month);
    return Math.max(0,value.quantity ?? 0) * (settings.anomalies && a && a.positive > 0 ? clamp(1-a.excess/a.positive,0,1):1);
  };
  const recent = [-3,-2,-1].map(n=>cleanAt(shiftMonth(current,n)));
  const previous = [-15,-14,-13].map(n=>cleanAt(shiftMonth(current,n)));
  let growthFactor = 1;
  if (settings.growth && recent.every(v=>v!==null) && previous.every(v=>v!==null)) {
    const prior = previous.reduce<number>((s,v)=>s+(v??0),0);
    if (prior>0) growthFactor=clamp(recent.reduce<number>((s,v)=>s+(v??0),0)/prior,.5,1.5);
    else notes.push('Рост нейтрален: в сопоставимом периоде прошлого года нет положительной базы.');
  } else if (settings.growth) notes.push('Рост нейтрален: недостаточно сопоставимых месяцев.');
  const forecastMonths = Array.from({length:settings.horizon},(_,i)=>{
    const month=shiftMonth(current,i+1), season=settings.seasonality ? clamp(data.seasonality[month.slice(5)]??1,.7,1.3):1;
    return {month,season,quantity:baseline*growthFactor*season*(1+settings.stockoutPercent/100)};
  });
  const forecast=forecastMonths.reduce((s,m)=>s+m.quantity,0);
  const validStock = product.stock!==null && Number.isFinite(product.stock) && product.stock>=0;
  const validTransit=product.transit!==null && Number.isFinite(product.transit) && product.transit>=0;
  const validMultiple=product.multiple!==null && Number.isInteger(product.multiple) && product.multiple>0;
  const eligible=validStock && validTransit && validMultiple && usable.length>0;
  const netNeed=validStock && validTransit ? Math.max(0,forecast-product.stock!-product.transit!):null;
  const order=eligible ? Math.ceil(Math.max(0,netNeed!-1e-9)/product.multiple!)*product.multiple!:null;
  const monthlyForecast=forecast/settings.horizon;
  const coverage=validStock && monthlyForecast>0 ? product.stock!/monthlyForecast:null;
  const urgency=!eligible?'review':order===0?'covered':product.stock===0?'critical':coverage!==null && coverage<settings.horizon/2?'high':'planned';
  const anomalyCount=product.anomalies.filter(a=>a.month>=start&&a.month<current).reduce((s,a)=>s+a.count,0);
  if (!validStock || !validTransit) notes.push('Нет подтверждённых неотрицательных остатков / товара в пути. Заказ требует проверки.');
  if (!validMultiple) notes.push('Нет подтверждённой кратности MOQ-файла. Заказ не округляется и не предлагается.');
  if (!usable.length) notes.push('Нет пригодной месячной истории. Заказ требует проверки.');
  if (usable.length<12) notes.push(`База: ${usable.length} из 12 полных месяцев.`);
  const blanks=history.filter(m=>m.raw===null).length;
  if(blanks) notes.push(`${blanks} пустых месяцев: ${settings.blankAsZero?'приняты за 0 по настройке сценария':'исключены из среднего'}.`);
  if(history.some(m=>m.raw!==null&&m.raw<0)) notes.push('Отрицательные месячные продажи ограничены нулём; исходные значения сохранены.');
  if(anomalyCount) notes.push(`IQR: ${anomalyCount} крупных операций. ${settings.anomalies?'Доля превышения порога уменьшает месячный спрос':'Коррекция отключена'}. Источники операций и месячных продаж могут расходиться.`);
  if(settings.stockoutPercent) notes.push(`Ручной сценарий stockout: +${settings.stockoutPercent}%. Это не измеренная история отсутствия.`);
  return {...product, baseline,growthFactor,seasonFactor:forecastMonths.reduce((s,m)=>s+m.season,0)/settings.horizon,forecast,netNeed,order,coverage,urgency,history,forecastMonths,anomalyCount,notes,validMonths:usable.length};
}
export function calculateAll(data: AppDataset, settings: Settings): Recommendation[] {
  const rank={critical:0,high:1,planned:2,review:3,covered:4};
  return data.products.map(p=>calculate(p,data,settings)).sort((a,b)=>rank[a.urgency]-rank[b.urgency]||(b.order??0)-(a.order??0)||a.sku.localeCompare(b.sku));
}
