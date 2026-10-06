"use client";

import { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar, Legend, PieChart, Pie, Cell } from 'recharts';
import * as XLSX from 'xlsx';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'optimizer' | 'screener' | 'model' | 'crm'>('crm');

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

  const addAsset = () => setPortfolio([...portfolio, { ticker: '', weight: '' }]);
  const updateAsset = (index: number, field: string, value: any) => {
    const newPortfolio = [...portfolio]; newPortfolio[index] = { ...newPortfolio[index], [field]: value }; setPortfolio(newPortfolio);
  };
  const removeAsset = (index: number) => setPortfolio(portfolio.filter((_, i) => i !== index));

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
    setScreenLoading(true); setScreenError(null);
    try {
      const res = await fetch('https://quant-api-3778.onrender.com/api/v1/screener');
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Error Data Lake");
      setScreenerData(data.top_picks || []);
    } catch (err: any) { setScreenError(err.message); }
    setScreenLoading(false);
  };

  const runModelPortfolio = async () => {
    if (modelPortfolio && !modelPortfolio.error) return;
    setModelLoading(true);
    try {
      const res = await fetch('https://quant-api-3778.onrender.com/api/v1/model_portfolio');
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);
      setModelPortfolio(data);
    } catch (err: any) { setModelPortfolio({ error: err.message }); }
    setModelLoading(false);
  };

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

  // ================= GRÁFICOS Y DATOS =================
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

  const generateProjectionData = () => {
    if (!optResults || !optResults.current_performance_metrics) return [];
    const data = [];
    let currentVal = 10000; let optVal = 10000; let csVal = 10000;
    const r_curr = optResults.current_performance_metrics.expected_annual_return_pct / 100;
    const r_opt = optResults.performance_metrics.expected_annual_return_pct / 100;
    const r_cs = optResults.cs_performance_metrics.expected_annual_return_pct / 100;
    for(let i = 0; i <= 10; i++) {
      data.push({ year: `Año ${i}`, "Tu Cartera": Math.round(currentVal), "Markowitz Estándar": Math.round(optVal), "Core-Satellite (Recomendada)": Math.round(csVal) });
      currentVal *= (1 + r_curr); optVal *= (1 + r_opt); csVal *= (1 + r_cs);
    }
    return data;
  };

  const generateBacktestData = () => {
    if (!modelPortfolio || !modelPortfolio.metrics) return [];
    const data = [];
    const r_quant = modelPortfolio.metrics.return_pct / 100;
    const r_spy = modelPortfolio.benchmark.return_pct / 100;
    const start_capital = 10000;
    for(let i = 0; i <= 36; i+=3) {
      data.push({ period: i === 0 ? "-36m" : i === 36 ? "Hoy" : `-${36 - i}m`, "Estrategia Quant": Math.round(start_capital * Math.pow(1 + r_quant, i/12)), "S&P 500 (SPY)": Math.round(start_capital * Math.pow(1 + r_spy, i/12)) });
    }
    return data;
  };

  const generateComparisonData = () => {
    if (!optResults) return [];
    const allTickers = Array.from(new Set([...Object.keys(optResults.current_weights || {}), ...Object.keys(optResults.optimal_weights || {}), ...Object.keys(optResults.cs_optimal_weights || {})]));
    return allTickers.map(ticker => ({
      ticker, "Actual %": optResults.current_weights[ticker] || 0, "Estándar %": optResults.optimal_weights[ticker] || 0, "Core-Satellite %": optResults.cs_optimal_weights[ticker] || 0
    })).sort((a, b) => b["Core-Satellite %"] - a["Core-Satellite %"]);
  };

  const PIE_COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B'];
  const projectionData = generateProjectionData();
  const backtestData = generateBacktestData();
  const comparisonData = generateComparisonData();

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

        {/* ================= VISTA CARTERA ESTRATEGICA ================= */}
        {activeTab === 'model' && (
          <div className="animate-fade-in space-y-6">
            <div className="bg-[#111111] p-8 rounded-xl border border-gray-800/60 shadow-sm">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-200 tracking-tight">Estrategia "All-Weather"</h2>
                  <p className="text-sm text-gray-500 mt-1">Evaluación multi-factor: Quality, Growth, Value y Sentimiento IA (FinBERT).</p>
                </div>
                <button onClick={() => { setModelPortfolio(null); runModelPortfolio(); }} className="bg-[#1a1a1a] border border-gray-700 hover:bg-gray-800 text-gray-300 px-4 py-2 rounded-md text-sm font-semibold transition-colors">
                  {modelLoading ? "Calculando..." : "↻ Recalcular Estrategia"}
                </button>
              </div>

              {modelLoading && !modelPortfolio ? (
                 <div className="flex justify-center py-20 text-emerald-500"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div></div>
              ) : modelPortfolio && !modelPortfolio.error ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-[#0a0a0a] p-6 rounded-xl border border-emerald-900/50 relative overflow-hidden">
                        <div className="absolute top-0 right-0 bg-emerald-900/40 text-emerald-400 text-[10px] px-2 py-1 rounded-bl font-bold border-l border-b border-emerald-900/50">QUANT</div>
                        <h3 className="text-gray-500 text-xs font-semibold tracking-wider mb-2">RENDIMIENTO ESPERADO</h3>
                        <p className="text-3xl font-bold text-emerald-400 mb-1">{modelPortfolio.metrics.return_pct}%</p>
                        <p className="text-[11px] text-gray-500 font-mono">Vol: {modelPortfolio.metrics.volatility_pct}% | Sharpe: {modelPortfolio.metrics.sharpe}</p>
                      </div>
                      <div className="bg-[#0a0a0a] p-6 rounded-xl border border-gray-800/60 relative">
                        <div className="absolute top-0 right-0 bg-gray-800/50 text-gray-400 text-[10px] px-2 py-1 rounded-bl font-bold border-l border-b border-gray-800/60">S&P 500</div>
                        <h3 className="text-gray-500 text-xs font-semibold tracking-wider mb-2">BENCHMARK</h3>
                        <p className="text-3xl font-bold text-gray-200 mb-1">{modelPortfolio.benchmark.return_pct}%</p>
                        <p className="text-[11px] text-gray-500 font-mono">Vol: {modelPortfolio.benchmark.volatility_pct}% | Sharpe: {modelPortfolio.benchmark.sharpe}</p>
                      </div>
                    </div>
                    
                    <div className="bg-[#0a0a0a] p-6 rounded-xl border border-gray-800/60 h-64 flex flex-col">
                      <h3 className="text-xs font-semibold tracking-wider text-gray-500 mb-4">BACKTEST HISTÓRICO (3 AÑOS)</h3>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={backtestData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorQuant" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.2}/><stop offset="95%" stopColor="#10B981" stopOpacity={0}/></linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                          <XAxis dataKey="period" stroke="#666" tick={{fontSize: 10}} />
                          <YAxis stroke="#666" tickFormatter={(val) => `$${val/1000}k`} tick={{fontSize: 10}} domain={['dataMin', 'dataMax']} />
                          <RechartsTooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} formatter={(value: any) => [`$${value.toLocaleString()}`, undefined]} />
                          <Area type="monotone" dataKey="S&P 500 (SPY)" stroke="#555" fill="transparent" strokeWidth={2} />
                          <Area type="monotone" dataKey="Estrategia Quant" stroke="#10B981" fill="url(#colorQuant)" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="bg-[#0a0a0a] p-6 rounded-xl border border-gray-800/60">
                    <h3 className="text-gray-300 font-bold mb-4 tracking-wide">Composición & Rationale Institucional</h3>
                    <div className="space-y-4">
                      {modelPortfolio.assets.map((asset: any, idx: number) => (
                        <div key={idx} className="flex flex-col border-b border-gray-800/60 pb-3 last:border-0">
                          <div className="flex justify-between items-start mb-1">
                            <div>
                              <span className="font-bold text-sm text-gray-200">{asset.ticker}</span>
                              <span className="text-[10px] text-gray-500 ml-2 uppercase">{asset.name}</span>
                            </div>
                            <span className="font-mono text-emerald-400 text-xs font-bold bg-emerald-900/20 px-1.5 py-0.5 rounded border border-emerald-900/50">{asset.weight}%</span>
                          </div>
                          <div className="w-full bg-gray-900 h-1 rounded-full overflow-hidden mb-2">
                             <div className="bg-emerald-500 h-full" style={{width: `${asset.weight}%`}}></div>
                          </div>
                          <div className="text-[10px] text-emerald-500/80 flex items-center gap-1.5 font-medium">
                             <span>↳</span> {asset.rationale}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-red-900/10 border border-red-900/50 text-red-400 p-10 rounded-xl text-center">
                  <span className="text-3xl block mb-2 opacity-50">⚠️</span>
                  {modelPortfolio?.error || "Datos insuficientes en el Data Lake."}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= VISTA OPTIMIZADOR DUAL ================= */}
        {activeTab === 'optimizer' && (
           <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in">
              <div className="lg:col-span-4 bg-[#111111] p-6 rounded-xl border border-gray-800/60 shadow-sm h-fit">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-sm font-bold text-gray-200 tracking-wide">CARTERA CLIENTE</h2>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded border ${totalWeight >= 99.9 ? 'bg-emerald-900/20 text-emerald-400 border-emerald-900/50' : 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                    Suma: {totalWeight.toFixed(2)}%
                  </span>
                </div>
                
                <div className="flex gap-2 mb-4">
                  <button onClick={addAsset} className="flex-1 bg-[#1a1a1a] hover:bg-gray-800 text-gray-300 py-2 rounded-md text-xs font-semibold border border-gray-700 transition-colors">
                    + Manual
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} className="flex-1 bg-blue-900/20 hover:bg-blue-900/40 border border-blue-900/50 text-blue-400 py-2 rounded-md text-xs font-semibold transition-colors flex items-center justify-center gap-2">
                    📄 Subir Excel
                  </button>
                  <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx, .xls, .csv" className="hidden" />
                </div>

                <div className="space-y-2 mb-6">
                  {portfolio.map((item, index) => {
                    const normalizedWeight = totalWeight > 0 ? (parseWeight(item.weight) / totalWeight) * 100 : 0;
                    return (
                      <div key={index} className="flex flex-col gap-1 bg-[#0a0a0a] p-2 rounded-md border border-gray-800/60">
                        <div className="flex gap-2">
                          <input type="text" value={item.ticker} onChange={(e) => updateAsset(index, 'ticker', e.target.value)} className="w-1/2 bg-[#111111] border border-gray-700/50 rounded-sm text-gray-200 focus:border-emerald-500 uppercase text-xs px-2 py-1.5 outline-none" placeholder="Ticker" />
                          <div className="w-1/2 flex relative">
                            <input type="text" value={item.weight} onChange={(e) => updateAsset(index, 'weight', e.target.value)} className="w-full bg-[#111111] border border-gray-700/50 rounded-sm text-gray-200 focus:border-emerald-500 pr-6 text-xs px-2 py-1.5 outline-none" placeholder="0.00" />
                            <span className="absolute right-2 top-1.5 text-gray-500 text-xs">%</span>
                          </div>
                          <button onClick={() => removeAsset(index)} className="text-gray-500 hover:text-red-400 px-1 font-bold transition-colors">✕</button>
                        </div>
                        <div className="text-right text-[9px] text-gray-500 font-mono">Peso real: <span className="text-emerald-500/70">{normalizedWeight.toFixed(2)}%</span></div>
                      </div>
                    );
                  })}
                </div>

                <div className="bg-emerald-900/10 p-3 rounded-md border border-emerald-900/30 mb-6">
                  <label className="text-[10px] text-emerald-400 font-bold tracking-wider mb-2 flex justify-between">
                    <span>🛡️ OVERRIDE CORE MIN (%)</span>
                    <span className="text-gray-500 font-normal">Opcional</span>
                  </label>
                  <input type="number" placeholder="Ej: 15" value={coreMinOverride} onChange={(e) => setCoreMinOverride(e.target.value)} className="w-full bg-[#0a0a0a] border border-gray-700/50 rounded-sm text-gray-200 focus:border-emerald-500 text-xs px-2 py-1.5 outline-none placeholder-gray-600"/>
                </div>

                <button onClick={runOptimizer} disabled={optLoading} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-bold py-2.5 rounded-md transition-colors shadow-sm text-sm">
                  {optLoading ? "Calculando..." : "Simular Escenarios"}
                </button>
                {optError && <p className="text-red-400 mt-3 text-xs text-center font-bold bg-red-900/20 p-2 rounded">{optError}</p>}
              </div>

              <div className="lg:col-span-8 space-y-6">
                {optResults && optResults.current_performance_metrics ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-[#111111] p-5 rounded-xl border border-gray-800/60 shadow-sm">
                        <h3 className="text-gray-500 text-[10px] font-bold tracking-wider mb-3">CARTERA ACTUAL</h3>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-sm"><span className="text-gray-400">Rendimiento:</span><span className="font-bold text-gray-200">{optResults.current_performance_metrics.expected_annual_return_pct}%</span></div>
                          <div className="flex justify-between text-sm"><span className="text-gray-400">Volatilidad:</span><span className="font-bold text-orange-400/80">{optResults.current_performance_metrics.annual_volatility_pct}%</span></div>
                          <div className="flex justify-between border-t border-gray-800/60 pt-1.5 text-xs"><span className="text-gray-500">Sharpe Ratio:</span><span className="font-mono text-gray-400">{optResults.current_performance_metrics.sharpe_ratio}</span></div>
                        </div>
                      </div>
                      
                      <div className="bg-[#111111] p-5 rounded-xl border border-blue-900/30 shadow-sm">
                        <h3 className="text-blue-500/70 text-[10px] font-bold tracking-wider mb-3">MARKOWITZ ESTÁNDAR</h3>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-sm"><span className="text-gray-400">Rendimiento:</span><span className="font-bold text-blue-400">{optResults.performance_metrics.expected_annual_return_pct}%</span></div>
                          <div className="flex justify-between text-sm"><span className="text-gray-400">Volatilidad:</span><span className="font-bold text-blue-400">{optResults.performance_metrics.annual_volatility_pct}%</span></div>
                          <div className="flex justify-between border-t border-gray-800/60 pt-1.5 text-xs"><span className="text-gray-500">Sharpe Ratio:</span><span className="font-mono text-blue-400/70">{optResults.performance_metrics.sharpe_ratio}</span></div>
                        </div>
                      </div>

                      <div className="bg-gradient-to-br from-[#111] to-[#0a1510] p-5 rounded-xl border border-emerald-900/50 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 right-0 bg-emerald-900/40 text-emerald-400 text-[9px] px-2 py-0.5 rounded-bl font-bold border-l border-b border-emerald-900/50">RECOMENDADO</div>
                        <h3 className="text-emerald-500/70 text-[10px] font-bold tracking-wider mb-3">CORE-SATELLITE</h3>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-sm"><span className="text-gray-400">Rendimiento:</span><span className="font-bold text-emerald-400">{optResults.cs_performance_metrics.expected_annual_return_pct}%</span></div>
                          <div className="flex justify-between text-sm"><span className="text-gray-400">Volatilidad:</span><span className="font-bold text-emerald-400">{optResults.cs_performance_metrics.annual_volatility_pct}%</span></div>
                          <div className="flex justify-between border-t border-gray-800/60 pt-1.5 text-xs"><span className="text-gray-500">Sharpe Ratio:</span><span className="font-mono text-emerald-400/70">{optResults.cs_performance_metrics.sharpe_ratio}</span></div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-[#111111] p-6 rounded-xl border border-gray-800/60 shadow-sm">
                      <h3 className="text-xs font-bold text-gray-400 tracking-wider mb-4">TRANSICIÓN DE PESOS</h3>
                      <div className="h-56 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={comparisonData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                            <XAxis dataKey="ticker" stroke="#666" tick={{fontSize: 10}} interval={0} />
                            <YAxis stroke="#666" tickFormatter={(val) => `${val}%`} tick={{fontSize: 10}} />
                            <RechartsTooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '8px' }} formatter={(val) => `${val}%`} />
                            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                            <Bar dataKey="Actual %" fill="#4B5563" radius={[2, 2, 0, 0]} />
                            <Bar dataKey="Estándar %" fill="#3B82F6" radius={[2, 2, 0, 0]} />
                            <Bar dataKey="Core-Satellite %" fill="#10B981" radius={[2, 2, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="bg-[#111111] p-6 rounded-xl border border-gray-800/60 shadow-sm">
                      <div className="flex justify-between items-center mb-6 border-b border-gray-800/60 pb-3">
                        <h2 className="text-sm font-bold text-gray-300 tracking-wider">PLAN DE ACCIÓN EJECUTIVO</h2>
                        <div className="flex bg-[#0a0a0a] rounded-md p-1 border border-gray-800/60">
                          <button onClick={() => setViewActionPlan('cs')} className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-colors ${viewActionPlan === 'cs' ? 'bg-emerald-600/20 text-emerald-400' : 'text-gray-500 hover:text-gray-300'}`}>CORE-SATELLITE</button>
                          <button onClick={() => setViewActionPlan('standard')} className={`px-3 py-1 text-[10px] font-bold rounded-sm transition-colors ${viewActionPlan === 'standard' ? 'bg-blue-600/20 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>ESTÁNDAR</button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                          <h3 className="text-red-400/80 text-xs font-bold tracking-wider mb-3 border-b border-red-900/30 pb-2">VENDER / REDUCIR</h3>
                          <ul className="space-y-2">
                            {(viewActionPlan === 'cs' ? optResults.cs_rebalance_orders : optResults.rebalance_orders)
                              .filter((o: any) => o.action === "VENDER").map((order: any, idx: number) => (
                              <li key={idx} className="flex justify-between items-center text-xs">
                                <span className="font-semibold text-gray-300">{order.asset}</span>
                                <span className="text-gray-500">Vender <span className="text-red-400 font-bold">{order.delta_pct}%</span></span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h3 className="text-emerald-400/80 text-xs font-bold tracking-wider mb-3 border-b border-emerald-900/30 pb-2">COMPRAR / SUMAR</h3>
                          <ul className="space-y-2">
                            {(viewActionPlan === 'cs' ? optResults.cs_rebalance_orders : optResults.rebalance_orders)
                              .filter((o: any) => o.action === "COMPRAR").map((order: any, idx: number) => (
                              <li key={idx} className="flex justify-between items-center text-xs">
                                <span className="font-semibold text-gray-300">
                                  {order.asset} {order.is_core && <span className="ml-2 text-[8px] bg-emerald-900/30 text-emerald-500 px-1 py-0.5 rounded border border-emerald-900/50">CORE</span>}
                                </span>
                                <span className="text-gray-500">Comprar <span className="text-emerald-400 font-bold">{order.delta_pct}%</span></span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="h-full border border-dashed border-gray-800/60 rounded-xl flex flex-col items-center justify-center text-gray-600 bg-[#111111]/50 p-10 text-center min-h-[400px]">
                    <svg className="w-12 h-12 mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                    <p className="text-sm">Configura la cartera y presiona Simular Escenarios.</p>
                  </div>
                )}
              </div>
           </div>
        )}

        {/* ================= VISTA SCREENER ================= */}
        {activeTab === 'screener' && (
          <div className="animate-fade-in space-y-6">
            <div className="bg-[#111111] p-6 rounded-xl border border-gray-800/60 shadow-sm">
               <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-gray-200 tracking-tight">Screener Fundamental + IA</h2>
                    <p className="text-xs text-gray-500 mt-1">Análisis de los activos del Data Lake en tiempo real.</p>
                  </div>
                  <button onClick={() => { setScreenerData([]); runScreener(); }} className="bg-[#1a1a1a] border border-gray-700 hover:bg-gray-800 text-gray-300 px-4 py-2 rounded-md text-xs font-semibold transition-colors">
                    {screenLoading ? "Analizando..." : "↻ Refrescar Datos"}
                  </button>
               </div>
               
               {screenLoading ? (
                 <div className="flex justify-center py-20 text-emerald-500"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div></div>
               ) : screenerData.length > 0 ? (
                 <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {screenerData.map((item, idx) => (
                      <div key={idx} className="bg-[#0a0a0a] p-4 rounded-lg border border-gray-800/60 hover:border-gray-600 transition-colors">
                         <div className="flex justify-between items-start mb-2">
                           <span className="font-bold text-gray-200">{item.ticker}</span>
                           <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${item.recommendation === 'COMPRA FUERTE' ? 'bg-emerald-900/20 text-emerald-400 border-emerald-900/50' : item.recommendation === 'COMPRAR' ? 'bg-blue-900/20 text-blue-400 border-blue-900/50' : 'bg-gray-800 text-gray-400 border-gray-700'}`}>{item.recommendation}</span>
                         </div>
                         <div className="text-[10px] text-gray-500 mb-3 truncate uppercase">{item.name} | {item.sector}</div>
                         <div className="space-y-1 text-xs">
                           <div className="flex justify-between"><span className="text-gray-500">Sentimiento IA:</span><span className={`font-mono ${item.ai_score > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{item.ai_score}</span></div>
                           <div className="flex justify-between"><span className="text-gray-500">ROE:</span><span className="font-mono text-gray-300">{formatPct(item.roe)}</span></div>
                           <div className="flex justify-between"><span className="text-gray-500">Growth (YoY):</span><span className="font-mono text-gray-300">{formatPct(item.revenue_growth_yoy)}</span></div>
                           <div className="flex justify-between"><span className="text-gray-500">Fwd P/E:</span><span className="font-mono text-gray-300">{formatNum(item.forward_pe || item.pe_ratio)}x</span></div>
                         </div>
                      </div>
                    ))}
                 </div>
               ) : (
                 <div className="text-center text-gray-600 py-10 text-sm">Ejecuta actualizador.py en el backend para poblar el Data Lake.</div>
               )}
            </div>
          </div>
        )}

        {/* ================= VISTA CRM WEALTH ================= */}
        {activeTab === 'crm' && (
          <div className="space-y-6 animate-fade-in">
            {/* MACRO KPIs */}
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
              {/* PANEL IZQUIERDO */}
              <div className="lg:col-span-4 bg-[#111111] rounded-xl border border-gray-800/60 shadow-sm flex flex-col overflow-hidden">
                <div className="p-5 border-b border-gray-800/60 bg-[#161616]">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-sm font-bold text-gray-200 tracking-wide">DIRECTORIO</h2>
                    <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded">{crmAccounts.length}</span>
                  </div>
                  
                  <div className="flex gap-2 mb-4">
                    <input type="text" value={newAccName} onChange={e=>setNewAccName(e.target.value)} placeholder="Ticker/ID" className="w-1/3 bg-[#0a0a0a] border border-gray-700 focus:border-emerald-500 text-white px-2 py-1.5 text-xs rounded outline-none transition-colors"/>
                    <input type="number" value={newAccAUM} onChange={e=>setNewAccAUM(e.target.value)} placeholder="USD" className="w-1/3 bg-[#0a0a0a] border border-gray-700 focus:border-emerald-500 text-white px-2 py-1.5 text-xs rounded outline-none transition-colors"/>
                    <button onClick={createAccount} className="w-1/3 bg-gray-800 hover:bg-gray-700 text-white text-xs font-bold rounded transition-colors">+</button>
                  </div>

                  <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                    <button onClick={()=>setCrmFilter('all')} className={`px-3 py-1 rounded-full text-[10px] font-bold transition-colors border ${crmFilter==='all' ? 'bg-gray-200 text-black border-gray-200' : 'bg-transparent text-gray-500 border-gray-700 hover:text-white'}`}>TODOS</button>
                    <button onClick={()=>setCrmFilter('red')} className={`px-3 py-1 rounded-full text-[10px] font-bold transition-colors border ${crmFilter==='red' ? 'bg-red-500/10 text-red-400 border-red-500/50' : 'bg-transparent text-gray-500 border-gray-700 hover:text-white'}`}>RIESGO</button>
                    <button onClick={()=>setCrmFilter('prospect')} className={`px-3 py-1 rounded-full text-[10px] font-bold transition-colors border ${crmFilter==='prospect' ? 'bg-white/10 text-white border-white/30' : 'bg-transparent text-gray-500 border-gray-700 hover:text-white'}`}>PROSPECTOS</button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {filteredAccounts.map(acc => {
                    const status = getAlertStatus(acc);
                    const isSelected = selectedAccount?.id === acc.id;
                    return (
                      <div key={acc.id} onClick={() => { setSelectedAccount(acc); fetchEvents(acc.id); }} 
                           className={`group p-3 rounded-lg cursor-pointer transition-all duration-200 flex justify-between items-center ${isSelected ? 'bg-gray-800/80 border border-gray-700' : 'bg-transparent border border-transparent hover:bg-gray-800/30'}`}>
                        <div className="flex items-center gap-3">
                          <span className={`w-2 h-2 rounded-full ${status.dot}`}></span>
                          <div>
                            <div className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-gray-300 group-hover:text-white'}`}>{acc.nro_cuenta}</div>
                            <div className="text-[10px] text-gray-500 font-mono mt-0.5">${acc.aum_total.toLocaleString()}</div>
                          </div>
                        </div>
                        <div className="text-right">
                           <div className={`text-[9px] font-bold tracking-wider ${status.color}`}>{status.badge}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* PANEL DERECHO */}
              <div className="lg:col-span-8 bg-[#111111] rounded-xl border border-gray-800/60 shadow-sm flex flex-col overflow-hidden">
                {!selectedAccount ? (
                  <div className="h-full flex flex-col items-center justify-center text-gray-600">
                    <svg className="w-16 h-16 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    <p className="text-sm font-medium">Selecciona una cuenta del directorio</p>
                  </div>
                ) : (
                  <div className="h-full flex flex-col animate-fade-in">
                    <div className="p-6 border-b border-gray-800/60 bg-gradient-to-r from-[#161616] to-[#111111]">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <h2 className="text-2xl font-bold text-white tracking-tight">{selectedAccount.nro_cuenta}</h2>
                            <span className="bg-gray-800 text-gray-300 text-[10px] px-2 py-0.5 rounded border border-gray-700">{selectedAccount.perfil_riesgo}</span>
                          </div>
                          <p className="text-3xl font-mono font-light text-emerald-400 mt-2">${selectedAccount.aum_total.toLocaleString()} <span className="text-sm text-gray-500">USD</span></p>
                        </div>
                        <div className="text-right">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border ${getAlertStatus(selectedAccount).color}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${getAlertStatus(selectedAccount).dot}`}></span>
                            {getAlertStatus(selectedAccount).badge}
                          </span>
                          <p className="text-[10px] text-gray-500 mt-2">Última act: {new Date(selectedAccount.fecha_ultima_interaccion).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-0">
                      <div className="p-6 border-r border-gray-800/60 flex flex-col">
                        <h3 className="text-xs font-bold tracking-wider text-gray-400 mb-6">ASIGNACIÓN TEÓRICA</h3>
                        <div className="flex-1 flex flex-col items-center justify-center min-h-[200px] relative">
                          {selectedAccount.aum_total > 0 ? (
                            <>
                              <ResponsiveContainer width="100%" height={220}>
                                <PieChart>
                                  <Pie data={[
                                      { name: 'Renta Variable (Core)', value: selectedAccount.perfil_riesgo === 'Agresivo' ? 60 : 40 },
                                      { name: 'Renta Variable (Satélites)', value: selectedAccount.perfil_riesgo === 'Agresivo' ? 20 : 15 },
                                      { name: 'Renta Fija / Bonos', value: selectedAccount.perfil_riesgo === 'Agresivo' ? 15 : 35 },
                                      { name: 'Liquidez', value: selectedAccount.perfil_riesgo === 'Agresivo' ? 5 : 10 },
                                    ]} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2} dataKey="value" stroke="none">
                                    {PIE_COLORS.map((color, index) => <Cell key={`cell-${index}`} fill={color} />)}
                                  </Pie>
                                  <RechartsTooltip contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#333', fontSize: '12px' }} itemStyle={{ color: '#fff' }} />
                                </PieChart>
                              </ResponsiveContainer>
                              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <span className="text-xs text-gray-500">AUM</span>
                                <span className="text-sm font-bold text-white">${(selectedAccount.aum_total / 1000).toFixed(1)}k</span>
                              </div>
                            </>
                          ) : (
                             <div className="text-center text-gray-600">
                               <span className="text-3xl block mb-2">🎯</span>
                               <p className="text-xs">Cuenta sin fondear. Diseña una propuesta.</p>
                             </div>
                          )}
                        </div>
                        <div className="mt-6 pt-6 border-t border-gray-800/60">
                           <button onClick={() => setActiveTab('optimizer')} className="w-full bg-[#161616] hover:bg-gray-800 text-emerald-400 text-xs font-bold py-2.5 rounded border border-gray-700 transition-colors flex justify-center items-center gap-2">
                             <span>⚙️</span> Iniciar Rebalanceo Cuantitativo
                           </button>
                        </div>
                      </div>

                      <div className="p-6 flex flex-col bg-[#0f0f0f]">
                        <h3 className="text-xs font-bold tracking-wider text-gray-400 mb-4">ACTIVITY FEED</h3>
                        <div className="flex gap-2 mb-6">
                          <select value={newEventType} onChange={e=>setNewEventType(e.target.value)} className="bg-[#1a1a1a] border border-gray-700 text-xs rounded px-2 text-gray-300 outline-none focus:border-gray-500">
                            <option>Llamada</option><option>WhatsApp</option><option>Licitación</option><option>Rebalanceo</option>
                          </select>
                          <input type="text" value={newEventDesc} onChange={e=>setNewEventDesc(e.target.value)} placeholder="Registro de interacción..." className="flex-1 bg-[#1a1a1a] border border-gray-700 text-xs rounded px-3 py-2 text-white outline-none focus:border-gray-500 transition-colors"/>
                          <button onClick={createEvent} className="bg-gray-800 hover:bg-gray-700 text-white px-3 py-1 rounded text-xs font-bold transition-colors">↳</button>
                        </div>
                        <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                          {crmEvents.length === 0 ? (
                            <p className="text-center text-xs text-gray-600 mt-10">Sin interacciones registradas.</p>
                          ) : (
                            crmEvents.map((ev, i) => (
                              <div key={ev.id} className="relative pl-4 border-l border-gray-800/80">
                                <span className="absolute left-[-4px] top-1.5 w-2 h-2 rounded-full bg-gray-600 border-2 border-[#0f0f0f]"></span>
                                <div className="text-[10px] text-gray-500 mb-0.5 flex justify-between">
                                  <span className="font-semibold text-gray-400 uppercase tracking-wider">{ev.tipo_evento}</span>
                                  <span>{new Date(ev.fecha_evento).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</span>
                                </div>
                                <p className="text-sm text-gray-300 leading-relaxed">{ev.descripcion}</p>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}