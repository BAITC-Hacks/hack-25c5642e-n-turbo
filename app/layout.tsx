import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'StockPilot AI — планирование закупок',description:'Объяснимые рекомендации заказа на основе локальных Excel'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ru"><body>{children}</body></html>;}
