import type { Recommendation, Settings } from './types';
function cell(value: unknown):string {
  let text=value===null||value===undefined?'':String(value);
  if(/^[=+\-@\t\r]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function exportCsv(rows:Recommendation[],settings:Settings,asOf:string):string {
  const header=['Код 1С','Артикул','Наименование','Категория','Прогноз','Свободный остаток','В пути','Кратность','Заказ','Срочность','Аномалии','Дата данных','Горизонт месяцев','Рост','Сезонность','IQR коррекция','Пустые месяцы как 0','Stockout сценарий %','Замечания'];
  return '\uFEFF'+[header,...rows.map(r=>[r.code,r.sku,r.name,r.category,r.forecast.toFixed(2),r.stock,r.transit,r.multiple,r.order,r.urgency,r.anomalyCount,asOf,settings.horizon,settings.growth,settings.seasonality,settings.anomalies,settings.blankAsZero,settings.stockoutPercent,r.notes.join(' | ')])].map(r=>r.map(cell).join(';')).join('\r\n');
}
