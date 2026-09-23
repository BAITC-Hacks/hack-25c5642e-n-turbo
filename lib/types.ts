export type MonthValue = { month: string; quantity: number | null };
export type AnomalyMonth = { month: string; positive: number; excess: number; count: number };
export type Product = {
  code: string; sku: string; name: string; multiple: number | null;
  stock: number | null; transit: number | null; category: string | null;
  monthly: MonthValue[]; stockHistory: MonthValue[];
  anomalies: AnomalyMonth[]; transactionCount: number; negativeTransactions: number;
  iqrThreshold: number | null; issues: string[]; sources: string[];
};
export type Dataset = { products: Product[]; asOf: string; loadedAt: string; files: { name: string; sheets: string[] }[]; warnings: string[]; transactionCount: number };
export type Settings = { horizon: number; growth: boolean; seasonality: boolean; anomalies: boolean; blankAsZero: boolean; stockoutPercent: number };
export type MonthlyPoint = { month: string; raw: number | null; cleaned: number; regular: number; assumedZero: boolean };
export type Recommendation = Product & {
  baseline: number; growthFactor: number; seasonFactor: number; forecast: number;
  netNeed: number | null; order: number | null; coverage: number | null;
  urgency: 'critical' | 'high' | 'planned' | 'covered' | 'review';
  history: MonthlyPoint[]; forecastMonths: { month: string; quantity: number; season: number }[];
  anomalyCount: number; notes: string[]; validMonths: number;
};
export type AppDataset = Dataset & { seasonality: Record<string, number> };
