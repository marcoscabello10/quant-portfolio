"use client";

import { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar, Legend, PieChart, Pie, Cell } from 'recharts';
import * as XLSX from 'xlsx';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'optimizer' | 'screener' | 'model' | 'crm'>('model');

  // ================= ESTADOS OPTIMIZADOR =================
  const [portfolio, setPortfolio] = useState([{ ticker: 'AAPL', weight: '30' }, { ticker: 'MRK', weight: '0.05' }, { ticker: 'BRKB', weight: '4.81' }]);
  const [coreMinOverride, setCoreMinOverride] = useState<string>('');
  const [optResults, setOptResults] = useState<any>(null);
  const [optLoading, setOptLoading] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);
  const [viewActionPlan, setViewActionPlan] = useState<'standard' | 'cs'>('cs');

  // ================= ESTADOS SCREENER Y MODELO =================
  const [screenerData, setScreenerData] = useState<any[]>([]);
  const [screenLoading, setScreenLoading] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [modelPortfolio, setModelPortfolio] = useState<any>(null);
  const [modelLoading, setModelLoading] = useState(false);

  // ================= ESTADOS CRM =================
  const [crmAccounts, setCrmAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [crmEvents, setCrmEvents] = useState<any[]>([]);
  const [crmFilter, setCrmFilter] = useState('all'); 
  
  const [newAccName, setNewAccName] = useState('');
  const [newAccAUM, setNewAccAUM] = useState('');
  const [newAccProfile, setNewAccProfile] = useState('Moderado');
  const [newEventDesc, setNewEventDesc] = useState('');
  const [newEventType, setNewEventType] = useState('Llamada');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ================= UTILIDADES =================
  const parseWeight = (val: string) => { const parsed = parseFloat(String(val).replace(',', '.')); return isNaN(parsed) ? 0 : parsed; };
  const totalWeight = portfolio.reduce((acc, item) => acc + parseWeight(item.weight), 0);
  const formatPct = (val: any) => { if (val == null) return 'N/A'; const num = parseFloat(val); return (num > 1 || num < -1) ? `${num.toFixed(1)}%` : `${(num * 100).toFixed(1)}%`; };
  const formatNum = (val: any) => val != null ? parseFloat(val).toFixed(2) : 'N/A';
  const formatBil = (val: any) => val != null ? `$${(parseFloat(val) / 1e9).toFixed(1)}B` : 'N/A';

  // ================= LECTOR EXCEL =================
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const tempPortfolio: any[] = [];
        let sumWeights = 0;

        data.slice(1).forEach((row: any) => {
          if (row[0]) {
             let wStr = String(row[2] || "0").replace('%', '').replace(',', '.').trim();
             let wNum = parseFloat(wStr);
             if (isNaN(wNum)) wNum = 0;
             sumWeights += wNum;
             tempPortfolio.push({ ticker: String(row[0]).trim().toUpperCase(), rawWeight: wNum });
          }
        });
        if (tempPortfolio.length > 0) {
           const isDecimalScale = sumWeights > 0 && sumWeights <= 1.05;
           const finalPortfolio = tempPortfolio.map(item => ({
             ticker: item.ticker, weight: isDecimalScale ? String(+(item.rawWeight * 100).toFixed(2)) : String(+(item.rawWeight).toFixed(2))
           }));
           setPortfolio(finalPortfolio);
           setOptError(null);
        }
      } catch (error) { setOptError("Error al leer el archivo Excel."); }
    };
    reader.readAsBinaryString(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ================= LLAMADAS API =================
  const runOptimizer = async () => {
    setOptLoading(true); setOptError(null); setOptResults(null);
    try {
      const payload: Record<string, number> = {};
      portfolio.forEach(item => { if (item.ticker.trim() !== '') payload[item.ticker.trim().toUpperCase()] = parseWeight(item.weight); });
      if (Object.keys(payload).length < 2) throw new Error("Requiere al menos 2 activos.");
      const payloadParams: any = { current_portfolio: payload };
      if (coreMinOverride.trim() !== '') {
          const cVal = parseFloat(coreMinOverride);
          if (!isNaN(cVal) && cVal > 0) payloadParams.core_min_weight = cVal;
      }
      const res = await fetch('https://quant-api-3778.onrender.com/api/v1/portfolio/optimize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadParams)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Error en el servidor Quant");
      setOptResults(data);
    } catch (err: any) { setOptError(err.message); }
    setOptLoading(false);
  };

  const runScreener = async () => {
    if (screenerData.length > 0) return;
    setScreenLoading(true);
    try {
      const res = await fetch('https://quant-api-3778.onrender.com/api/v1/screener');
      const data = await res.json();
      if (res.ok) setScreenerData(data.top_picks || []);
    } catch (err: any) {}
    setScreenLoading(false);
  };

  const runModelPortfolio = async () => {
    if (modelPortfolio) return;
    setModelLoading(true);
    try {
      const res = await fetch('https://quant-api-3778.onrender.com/api/v1/model_portfolio');
      const data = await res.json();
      if (res.ok) setModelPortfolio(data);
    } catch (err: any) {}
    setModelLoading(false);
  };

  // LÓGICA CRM
  const fetchCrmAccounts = async () => {
    try {
      const res = await fetch('https://quant-api-3778.onrender.com/api/v1/crm/accounts');
      const data = await res.json();
      if (res.ok) setCrmAccounts(data);
    } catch(err) {}
  };

  const createAccount = async () => {
    if (!newAccName) return;
    try {
      const aum = parseFloat(newAccAUM) || 0;
      await fetch('https://quant-api-3778.onrender.com/api/v1/crm/accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nro_cuenta: newAccName, aum_total: aum, perfil_riesgo: newAccProfile })
      });
      setNewAccName(''); setNewAccAUM(''); setNewAccProfile('Moderado');
      fetchCrmAccounts();
    } catch(err) {}
  };

  const fetchEvents = async (id: string) => {
    try {
      const res = await fetch(`https://quant-api-3778.onrender.com/api/v1/crm/events/${id}`);
      const data = await res.json();
      if (res.ok) setCrmEvents(data);
    } catch(err) {}
  };

  const createEvent = async () => {
    if (!selectedAccount || !newEventDesc) return;
    try {
      await fetch('https://quant-api-3778.onrender.com/api/v1/crm/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuenta_id: selectedAccount.id, tipo_evento: newEventType, descripcion: newEventDesc })
      });
      setNewEventDesc('');
      fetchEvents(selectedAccount.id);
      fetchCrmAccounts();
    } catch(err) {}
  };

  useEffect(() => {
    if (activeTab === 'screener') runScreener();
    if (activeTab === 'model') runModelPortfolio();
    if (activeTab === 'crm') fetchCrmAccounts();
  }, [activeTab]);

  // SEMÁFORO CRM Y KPIs GLOBALES
  const getAlertStatus = (acc: any) => {
    if (acc.aum_total == 0) return { color: 'text-gray-300 border-gray-600', dot: 'bg-gray-400', badge: 'PROSPECTO', filterKey: 'prospect' };
    const days = (new Date().getTime() - new Date(acc.fecha_ultima_interaccion).getTime()) / (1000 * 3600 * 24);
    if (days > 30) return { color: 'text-red-400 border-red-900/50', dot: 'bg-red-500', badge: 'RIESGO', filterKey: 'red' };
    if (days > 15) return { color: 'text-yellow-400 border-yellow-900/50', dot: 'bg-yellow-500', badge: 'ATENCIÓN', filterKey: 'yellow' };
    return { color: 'text-emerald-400 border-emerald-900/50', dot: 'bg-emerald-500', badge: 'SALUDABLE', filterKey: 'green' };
  };

  const filteredAccounts = crmAccounts.filter(acc => {
    if (crmFilter === 'all') return true;
    return getAlertStatus(acc).filterKey === crmFilter;
  });

  const totalGlobalAUM = crmAccounts.reduce((sum, acc) => sum + (acc.aum_total || 0), 0);
  const totalAtRisk = crmAccounts.filter(a => getAlertStatus(a).filterKey === 'red').length;

  // GRÁFICOS (Render logic from previous steps)
  // ... (Projection, Backtest, Comparison logic here - omitted for brevity, keeping existing logic)
  const generateComparisonData = () => {
    if (!optResults) return [];
    const allTickers = Array.from(new Set([...Object.keys(optResults.current_weights || {}), ...Object.keys(optResults.cs_optimal_weights || {})]));
    return allTickers.map(ticker => ({ ticker, "Actual %": optResults.current_weights[ticker] || 0, "Core-Satellite %": optResults.cs_optimal_weights[ticker] || 0 })).sort((a, b) => b["Core-Satellite %"] - a["Core-Satellite %"]);
  };
  const comparisonData = generateComparisonData();
  const PIE_COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B'];

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-gray-200 p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* HEADER GHOSTFOLIO STYLE */}
        <div className="flex justify-between items-end border-b border-gray-800/60 pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white mb-1 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
              Quant Terminal
            </h1>
            <p className="text-sm text-gray-500 tracking-wide">INSTITUTIONAL WEALTH MANAGEMENT</p>
          </div>
          
          <div className="flex gap-2">
            {['model', 'optimizer', 'screener', 'crm'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab as any)} 
                className={`px-5 py-2 text-sm font-semibold rounded-md transition-all duration-200 ${activeTab === tab ? 'bg-gray-800 text-white shadow-sm border border-gray-700' : 'bg-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-900/50'}`}>
                {tab === 'model' && 'Estrategia'}
                {tab === 'optimizer' && 'Optimizador'}
                {tab === 'screener' && 'Screener'}
                {tab === 'crm' && 'CRM Wealth'}
              </button>
            ))}
          </div>
        </div>

        {/* ================= VISTA CRM WEALTH (KOYFIN / GHOSTFOLIO STYLE) ================= */}
        {activeTab === 'crm' && (
          <div className="space-y-6 animate-fade-in">
            
            {/* MACRO KPIs (Global Dashboard) */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-[#111111] p-5 rounded-xl border border-gray-800/60 shadow-sm flex flex-col justify-center">
                <span className="text-xs text-gray-500 font-semibold tracking-wider mb-1">TOTAL AUM</span>
                <span className="text-2xl font-bold text-white">${totalGlobalAUM.toLocaleString()}</span>
              </div>
              <div className="bg-[#111111] p-5 rounded-xl border border-gray-800/60 shadow-sm flex flex-col justify-center">
                <span className="text-xs text-gray-500 font-semibold tracking-wider mb-1">CUENTAS ACTIVAS</span>
                <span className="text-2xl font-bold text-white">{crmAccounts.filter(a => a.aum_total > 0).length}</span>
              </div>
              <div className="bg-[#111111] p-5 rounded-xl border border-gray-800/60 shadow-sm flex flex-col justify-center">
                <span className="text-xs text-gray-500 font-semibold tracking-wider mb-1">PROSPECTOS</span>
                <span className="text-2xl font-bold text-gray-300">{crmAccounts.filter(a => a.aum_total === 0).length}</span>
              </div>
              <div className="bg-[#111111] p-5 rounded-xl border border-gray-800/60 shadow-sm flex flex-col justify-center">
                <span className="text-xs text-gray-500 font-semibold tracking-wider mb-1">CUENTAS EN RIESGO</span>
                <span className="text-2xl font-bold text-red-400">{totalAtRisk}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[600px]">
              
              {/* PANEL IZQUIERDO: DIRECTORIO MINIMALISTA */}
              <div className="lg:col-span-4 bg-[#111111] rounded-xl border border-gray-800/60 shadow-sm flex flex-col overflow-hidden">
                <div className="p-5 border-b border-gray