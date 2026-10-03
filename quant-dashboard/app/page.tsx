"use client";

import { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'optimizer' | 'screener' | 'model'>('model');

  // ================= ESTADOS =================
  const [portfolio, setPortfolio] = useState([
    { ticker: 'AAPL', weight: '30' },
    { ticker: 'MRK', weight: '0.05' },
    { ticker: 'BRKB', weight: '4.81' },
  ]);
  const [optResults, setOptResults] = useState<any>(null);
  const [optLoading, setOptLoading] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);

  const [screenerData, setScreenerData] = useState<any[]>([]);
  const [screenLoading, setScreenLoading] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);

  const [modelPortfolio, setModelPortfolio] = useState<any>(null);
  const [modelLoading, setModelLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ================= FUNCIONES AUXILIARES =================
  const parseWeight = (val: string) => { const parsed = parseFloat(String(val).replace(',', '.')); return isNaN(parsed) ? 0 : parsed; };
  const totalWeight = portfolio.reduce((acc, item) => acc + parseWeight(item.weight), 0);
  
  const addAsset = () => setPortfolio([...portfolio, { ticker: '', weight: '' }]);
  const updateAsset = (index: number, field: string, value: any) => {
    const newPortfolio = [...portfolio]; newPortfolio[index] = { ...newPortfolio[index], [field]: value }; setPortfolio(newPortfolio);
  };
  const removeAsset = (index: number) => setPortfolio(portfolio.filter((_, i) => i !== index));

  // ================= LECTOR DE EXCEL =================
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
        
        const newPortfolio: any[] = [];
        data.slice(1).forEach((row: any) => {
          if (row[0]) {
             newPortfolio.push({
               ticker: String(row[0]).trim().toUpperCase(),
               weight: String(row[2] || 0)
             });
          }
        });
        if (newPortfolio.length > 0) {
           setPortfolio(newPortfolio);
           setOptError(null);
        }
      } catch (error) {
        setOptError("Error al leer el archivo Excel. Verifica que tenga las columnas correctas.");
      }
    };
    reader.readAsBinaryString(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ================= LLAMADAS A LA API =================
  const runOptimizer = async () => {
    setOptLoading(true); setOptError(null); setOptResults(null);
    try {
      const payload: Record<string, number> = {};
      portfolio.forEach(item => { if (item.ticker.trim() !== '') payload[item.ticker.trim().toUpperCase()] = parseWeight(item.weight); });
      if (Object.keys(payload).length < 2) throw new Error("Requiere al menos 2 activos.");
      
      const res = await fetch('https://quant-api-3778.onrender.com/api/v1/portfolio/optimize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_portfolio: payload })
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
      if (!res.ok) throw new Error(data.detail || "Error al conectar con Data Lake");
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
      if (!res.ok) throw new Error(data.detail || "Fallo al calcular Frontera Eficiente");
      setModelPortfolio(data);
    } catch (err: any) {
      setModelPortfolio({ error: err.message });
    }
    setModelLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'screener') runScreener();
    if (activeTab === 'model') runModelPortfolio();
  }, [activeTab]);

  // ================= GRÁFICOS Y DATOS =================
  const groupedScreenerData = [...screenerData].sort((a, b) => {
    if ((a.sector || "") < (b.sector || "")) return -1;
    if ((a.sector || "") > (b.sector || "")) return 1;
    return (b.ai_score || 0) - (a.ai_score || 0);
  });

  const generateProjectionData = () => {
    if (!optResults || !optResults.current_performance_metrics) return [];
    const data = [];
    let currentVal = 10000; let optimalVal = 10000;
    const r_curr = optResults.current_performance_metrics.expected_annual_return_pct / 100;
    const r_opt = optResults.performance_metrics.expected_annual_return_pct / 100;
    for(let i = 0; i <= 10; i++) {
      data.push({ year: `Año ${i}`, "Tu Cartera": Math.round(currentVal), "Markowitz + IA": Math.round(optimalVal) });
      currentVal *= (1 + r_curr); optimalVal *= (1 + r_opt);
    }
    return data;
  };

  // BACKTEST A 3 AÑOS (FORWARD BACKTEST)
  const generateBacktestData = () => {
    if (!modelPortfolio || !modelPortfolio.metrics) return [];
    const data = [];
    const r_quant = modelPortfolio.metrics.return_pct / 100;
    const r_spy = modelPortfolio.benchmark.return_pct / 100;
    
    const start_capital = 10000;

    for(let i = 0; i <= 36; i+=3) {
      data.push({
        period: i === 0 ? "-36m" : i === 36 ? "Hoy" : `-${36 - i}m`,
        "Estrategia Quant": Math.round(start_capital * Math.pow(1 + r_quant, i/12)),
        "S&P 500 (SPY)": Math.round(start_capital * Math.pow(1 + r_spy, i/12))
      });
    }
    return data;
  };

  const projectionData = generateProjectionData();
  const backtestData = generateBacktestData();

  // ================= FORMATOS DE MÉTRICAS =================
  const formatPct = (val: any) => {
    if (val == null) return 'N/A';
    const num = parseFloat(val);
    return (num > 1 || num < -1) ? `${num.toFixed(1)}%` : `${(num * 100).toFixed(1)}%`;
  };
  const formatNum = (val: any) => val != null ? parseFloat(val).toFixed(2) : 'N/A';
  const formatBil = (val: any) => val != null ? `$${(parseFloat(val) / 1e9).toFixed(1)}B` : 'N/A';

  const renderDynamicMetrics = (asset: any) => {
    const sector = asset.sector || "";
    if (["Technology", "Consumer Cyclical", "Communication Services"].includes(sector)) {
      return (
        <div className="space-y-2">
          <MetricRow label="Forward P/E" value={formatNum(asset.forward_pe)} highlight={asset.forward_pe && asset.forward_pe < 25} />
          <MetricRow label="PEG Ratio" value={formatNum(asset.peg_ratio)} highlight={asset.peg_ratio && asset.peg_ratio < 1.5} />
          <MetricRow label="Crec. Ingresos (YoY)" value={formatPct(asset.revenue_growth_yoy)} highlight={asset.revenue_growth_yoy > 0.15} />
          <MetricRow label="Margen Bruto" value={formatPct(asset.gross_margin)} highlight={asset.gross_margin > 0.50} />
          <MetricRow label="Free Cash Flow" value={formatBil(asset.free_cash_flow)} highlight={asset.free_cash_flow > 5e9} />
          <MetricRow label="Riesgo Beta" value={formatNum(asset.beta)} highlight={asset.beta && asset.beta < 1.1} />
        </div>
      );
    } else if (["Financial Services"].includes(sector)) {
      return (
        <div className="space-y-2">
          <MetricRow label="Price to Book (P/B)" value={formatNum(asset.price_to_book)} highlight={asset.price_to_book && asset.price_to_book < 1.5} />
          <MetricRow label="Trailing P/E" value={formatNum(asset.pe_ratio)} highlight={asset.pe_ratio && asset.pe_ratio < 15} />
          <MetricRow label="ROA (Retorno Activos)" value={formatPct(asset.roa)} highlight={asset.roa > 0.015} />
          <MetricRow label="ROE (Retorno Cap.)" value={formatPct(asset.roe)} highlight={asset.roe > 0.10} />
          <MetricRow label="Dividend Yield" value={formatPct(asset.dividend_yield)} highlight={asset.dividend_yield > 0.03} />
          <MetricRow label="Payout Ratio" value={formatPct(asset.payout_ratio)} highlight={asset.payout_ratio && asset.payout_ratio < 0.6} />
        </div>
      );
    } else if (["Energy", "Industrials", "Basic Materials"].includes(sector)) {
      return (
        <div className="space-y-2">
          <MetricRow label="EV / EBITDA" value={formatNum(asset.ev_ebitda)} highlight={asset.ev_ebitda && asset.ev_ebitda < 10} />
          <MetricRow label="Price to Book (P/B)" value={formatNum(asset.price_to_book)} highlight={asset.price_to_book && asset.price_to_book < 2} />
          <MetricRow label="Margen Operativo" value={formatPct(asset.operating_margin)} highlight={asset.operating_margin > 0.15} />
          <MetricRow label="Flujo Caja Operativo" value={formatBil(asset.operating_cash_flow)} highlight={asset.operating_cash_flow > 1e9} />
          <MetricRow label="Dividend Yield" value={formatPct(asset.dividend_yield)} highlight={asset.dividend_yield > 0.03} />
          <MetricRow label="Riesgo Beta" value={formatNum(asset.beta)} highlight={asset.beta && asset.beta < 1} />
        </div>
      );
    } else {
      return (
        <div className="space-y-2">
          <MetricRow label="Trailing P/E" value={formatNum(asset.pe_ratio)} highlight={asset.pe_ratio && asset.pe_ratio < 20} />
          <MetricRow label="Deuda / Capital" value={formatNum(asset.debt_to_equity)} highlight={asset.debt_to_equity && asset.debt_to_equity < 60} />
          <MetricRow label="ROE (Retorno Cap.)" value={formatPct(asset.roe)} highlight={asset.roe > 0.15} />
          <MetricRow label="Dividend Yield" value={formatPct(asset.dividend_yield)} highlight={asset.dividend_yield > 0.02} />
          <MetricRow label="Payout Ratio" value={formatPct(asset.payout_ratio)} highlight={asset.payout_ratio && asset.payout_ratio < 0.6} />
          <MetricRow label="Riesgo Beta" value={formatNum(asset.beta)} highlight={asset.beta && asset.beta < 0.9} />
        </div>
      );
    }
  };

  const MetricRow = ({ label, value, highlight }: { label: string, value: string, highlight?: boolean }) => (
    <div className="flex justify-between items-center border-b border-gray-800 pb-1">
      <span className="text-gray-400 text-xs">{label}</span>
      <span className={`font-mono text-sm font-bold ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</span>
    </div>
  );

  return (
    <main className="min-h-screen bg-gray-950 text-white p-10 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        <div className="border-b border-gray-800 pb-6">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h1 className="text-4xl font-bold text-emerald-500 mb-1">Quant IA Platform</h1>
              <p className="text-gray-400">Terminal Institucional de Gestión de Carteras</p>
            </div>
            <div className="text-xs text-gray-500 font-mono text-right">
              STATUS: <span className="text-emerald-400 font-bold">ONLINE</span><br/>
              DATA LAKE: <span className="text-blue-400">ACTIVO</span>
            </div>
          </div>
          
          <div className="flex gap-4 mt-6">
            <button onClick={() => setActiveTab('model')} className={`px-6 py-2 rounded-t-lg font-bold transition-colors ${activeTab === 'model' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-800 border-t border-l border-r border-gray-800'}`}>⭐ Cartera Estratégica</button>
            <button onClick={() => setActiveTab('optimizer')} className={`px-6 py-2 rounded-t-lg font-bold transition-colors ${activeTab === 'optimizer' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-800 border-t border-l border-r border-gray-800'}`}>📊 Optimizador de Clientes</button>
            <button onClick={() => setActiveTab('screener')} className={`px-6 py-2 rounded-t-lg font-bold transition-colors ${activeTab === 'screener' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-800 border-t border-l border-r border-gray-800'}`}>🔎 Screener de Mercado</button>
          </div>
        </div>

        {/* ================= VISTA CARTERA MODELO ================= */}
        {activeTab === 'model' && (
          <div className="animate-fade-in space-y-6">
            <div className="bg-gray-900 p-8 rounded-b-xl rounded-tr-xl border border-gray-800 shadow-lg">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-200">Estrategia Cuantitativa "All-Weather"</h2>
                  <p className="text-sm text-gray-400 mt-1">Sintetizada evaluando los factores: Quality, Growth, Value y Sentimiento IA (FinBERT).</p>
                </div>
                <button onClick={() => { setModelPortfolio(null); runModelPortfolio(); }} className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-lg text-sm">
                  {modelLoading ? "Calculando Frontera..." : "↻ Recalcular Estrategia"}
                </button>
              </div>

              {modelLoading && !modelPortfolio ? (
                 <div className="flex justify-center py-20 text-emerald-500"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div></div>
              ) : modelPortfolio && !modelPortfolio.error ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                  
                  {/* COLUMNA IZQUIERDA: TARJETAS Y GRÁFICO */}
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-gray-950 p-6 rounded-xl border border-emerald-800 relative overflow-hidden">
                        <div className="absolute top-0 right-0 bg-emerald-600 text-xs px-2 py-1 rounded-bl font-bold">ESTRATEGIA QUANT</div>
                        <h3 className="text-gray-400 text-xs mb-3">RENDIMIENTO ESPERADO</h3>
                        <p className="text-3xl font-bold text-emerald-400 mb-1">{modelPortfolio.metrics.return_pct}%</p>
                        <p className="text-xs text-gray-500">Volatilidad: {modelPortfolio.metrics.volatility_pct}% | Sharpe: {modelPortfolio.metrics.sharpe}</p>
                      </div>
                      <div className="bg-gray-950 p-6 rounded-xl border border-gray-800 relative">
                        <div className="absolute top-0 right-0 bg-gray-700 text-xs px-2 py-1 rounded-bl font-bold">S&P 500 (SPY)</div>
                        <h3 className="text-gray-400 text-xs mb-3">BENCHMARK</h3>
                        <p className="text-3xl font-bold text-white mb-1">{modelPortfolio.benchmark.return_pct}%</p>
                        <p className="text-xs text-gray-500">Volatilidad: {modelPortfolio.benchmark.volatility_pct}% | Sharpe: {modelPortfolio.benchmark.sharpe}</p>
                      </div>
                    </div>
                    
                    {/* BACKTEST GRÁFICO */}
                    <div className="bg-gray-950 p-6 rounded-xl border border-gray-800 h-64 flex flex-col">
                      <h3 className="text-sm font-bold text-gray-300 mb-4">Backtest Histórico vs Benchmark (3 Años)</h3>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={backtestData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorQuant" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10B981" stopOpacity={0}/></linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                          <XAxis dataKey="period" stroke="#9CA3AF" tick={{fontSize: 10}} />
                          <YAxis stroke="#9CA3AF" tickFormatter={(val) => `$${val/1000}k`} tick={{fontSize: 10}} domain={['dataMin', 'dataMax']} />
                          <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff' }} formatter={(value: any) => [`$${value.toLocaleString()}`, undefined]} />
                          <Area type="monotone" dataKey="S&P 500 (SPY)" stroke="#6B7280" fill="transparent" strokeWidth={2} />
                          <Area type="monotone" dataKey="Estrategia Quant" stroke="#10B981" fill="url(#colorQuant)" strokeWidth={3} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* COLUMNA DERECHA: REPORTE DE ACTIVOS */}
                  <div className="bg-gray-950 p-6 rounded-xl border border-gray-800">
                    <h3 className="text-gray-200 font-bold mb-4">Composición y Rationale Institucional</h3>
                    <div className="space-y-4">
                      {modelPortfolio.assets.map((asset: any, idx: number) => (
                        <div key={idx} className="flex flex-col border-b border-gray-900 pb-3 last:border-0">
                          <div className="flex justify-between items-start mb-1">
                            <div>
                              <span className="font-bold text-lg text-white">{asset.ticker}</span>
                              <span className="text-xs text-gray-500 ml-2">| {asset.name}</span>
                            </div>
                            <span className="font-mono text-emerald-400 font-bold bg-emerald-900/30 px-2 py-0.5 rounded">{asset.weight}%</span>
                          </div>
                          
                          <div className="w-full bg-gray-900 h-1.5 rounded-full overflow-hidden mb-2">
                             <div className="bg-emerald-500 h-full" style={{width: `${asset.weight}%`}}></div>
                          </div>

                          <div className="text-xs text-emerald-500/80 flex items-center gap-1.5">
                             <span className="text-sm">✔</span> {asset.rationale}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-red-950/30 border border-red-900 text-red-400 p-10 rounded-xl text-center">
                  <span className="text-3xl block mb-2">⚠️</span>
                  {modelPortfolio?.error || "Aún no hay suficientes datos en el Data Lake."}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= VISTA OPTIMIZADOR CON EXCEL E INYECCIÓN FUNDAMENTAL ================= */}
        {activeTab === 'optimizer' && (
           <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in">
              <div className="lg:col-span-1 bg-gray-900 p-6 rounded-b-xl rounded-tr-xl border border-gray-800 shadow-lg h-fit">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold text-gray-200">Cartera Cliente</h2>
                  <span className={`text-sm font-bold px-2 py-1 rounded ${totalWeight >= 99.9 ? 'bg-emerald-900 text-emerald-400' : 'bg-blue-900 text-blue-400'}`}>
                    Suma: {totalWeight.toFixed(2)}%
                  </span>
                </div>
                
                <div className="flex gap-2 mb-6">
                  <button onClick={addAsset} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded-lg text-xs font-bold transition-colors shadow-inner">
                    + Añadir Manual
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} className="flex-1 bg-blue-900/40 hover:bg-blue-800/60 border border-blue-700/50 text-blue-400 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2">
                    📄 Subir Excel
                  </button>
                  <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx, .xls, .csv" className="hidden" />
                </div>

                <div className="space-y-3 mb-6">
                  {portfolio.map((item, index) => {
                    const numWeight = parseWeight(item.weight);
                    const normalizedWeight = totalWeight > 0 ? (numWeight / totalWeight) * 100 : 0;
                    return (
                      <div key={index} className="flex flex-col gap-1 bg-gray-950 p-2 rounded-lg border border-gray-800">
                        <div className="flex gap-2">
                          <input type="text" value={item.ticker} onChange={(e) => updateAsset(index, 'ticker', e.target.value)} className="w-1/2 bg-gray-900 border border-gray-700 rounded text-white focus:border-emerald-500 uppercase text-sm px-2 py-1" placeholder="Ticker" />
                          <div className="w-1/2 flex relative">
                            <input type="text" value={item.weight} onChange={(e) => updateAsset(index, 'weight', e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded text-white focus:border-emerald-500 pr-6 text-sm px-2 py-1" placeholder="0.00" />
                            <span className="absolute right-2 top-1 text-gray-500 text-sm">%</span>
                          </div>
                          <button onClick={() => removeAsset(index)} className="text-red-500 hover:text-red-400 px-2 font-bold">✕</button>
                        </div>
                        <div className="text-right text-[10px] text-gray-500 font-mono">
                          Peso en Cartera: <span className="text-emerald-500">{normalizedWeight.toFixed(2)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button onClick={runOptimizer} disabled={optLoading} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 text-white font-bold py-3 rounded-lg transition-colors shadow-lg">
                  {optLoading ? "Calculando Rebalanceo..." : "Simular Rebalanceo Inteligente"}
                </button>
                {optError && <p className="text-red-400 mt-3 text-sm text-center font-bold bg-red-900/20 p-2 rounded">{optError}</p>}
              </div>

              <div className="lg:col-span-2 space-y-6">
                {optResults && optResults.current_performance_metrics ? (
                  <>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg">
                        <h3 className="text-gray-400 text-sm mb-4">CARTERA ACTUAL</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between"><span className="text-gray-500">Rendimiento:</span><span className="text-xl font-bold">{optResults.current_performance_metrics.expected_annual_return_pct}%</span></div>
                          <div className="flex justify-between"><span className="text-gray-500">Volatilidad:</span><span className="text-xl font-bold text-orange-400">{optResults.current_performance_metrics.annual_volatility_pct}%</span></div>
                        </div>
                      </div>
                      <div className="bg-gray-900 p-6 rounded-xl border border-emerald-800 shadow-lg relative overflow-hidden">
                        <div className="absolute top-0 right-0 bg-emerald-600 text-xs px-2 py-1 rounded-bl font-bold">RECOMENDADO</div>
                        <h3 className="text-emerald-400 text-sm mb-4 font-bold">REBALANCEO OPTIMIZADO</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between"><span className="text-gray-400">Rendimiento:</span><span className="text-xl font-bold text-green-400">{optResults.performance_metrics.expected_annual_return_pct}%</span></div>
                          <div className="flex justify-between"><span className="text-gray-400">Volatilidad:</span><span className="text-xl font-bold text-green-400">{optResults.performance_metrics.annual_volatility_pct}%</span></div>
                        </div>
                      </div>
                    </div>

                    {/* RADIOGRAFÍA FUNDAMENTAL EXPANDIDA (6 MÉTRICAS) */}
                    {optResults.fundamental_metrics && (
                      <div className="bg-gray-900 p-6 rounded-xl border border-blue-900/30 shadow-lg">
                        <h2 className="text-lg font-bold text-blue-400 mb-4 flex items-center gap-2">
                          <span className="text-xl">🧬</span> Radiografía Fundamental (Data Lake)
                        </h2>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                            <span className="text-gray-500 text-xs block mb-1">P/E Promedio</span>
                            <div className="flex justify-between items-end">
                              <span className="text-gray-400 line-through text-sm">{optResults.fundamental_metrics.current_pe}x</span>
                              <span className="text-white font-bold text-lg">{optResults.fundamental_metrics.optimal_pe}x</span>
                            </div>
                          </div>
                          <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                            <span className="text-gray-500 text-xs block mb-1">Dividend Yield</span>
                            <div className="flex justify-between items-end">
                              <span className="text-gray-400 line-through text-sm">{optResults.fundamental_metrics.current_yield}%</span>
                              <span className="text-emerald-400 font-bold text-lg">{optResults.fundamental_metrics.optimal_yield}%</span>
                            </div>
                          </div>
                          <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                            <span className="text-gray-500 text-xs block mb-1">ROE Promedio</span>
                            <div className="flex justify-between items-end">
                              <span className="text-gray-400 line-through text-sm">{optResults.fundamental_metrics.current_roe}%</span>
                              <span className="text-blue-400 font-bold text-lg">{optResults.fundamental_metrics.optimal_roe}%</span>
                            </div>
                          </div>
                          <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                            <span className="text-gray-500 text-xs block mb-1">Riesgo (Beta Promedio)</span>
                            <div className="flex justify-between items-end">
                              <span className="text-gray-400 line-through text-sm">{optResults.fundamental_metrics.current_beta}</span>
                              <span className="text-orange-400 font-bold text-lg">{optResults.fundamental_metrics.optimal_beta}</span>
                            </div>
                          </div>
                          <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                            <span className="text-gray-500 text-xs block mb-1">PEG Ratio (Valoración)</span>
                            <div className="flex justify-between items-end">
                              <span className="text-gray-400 line-through text-sm">{optResults.fundamental_metrics.current_peg}x</span>
                              <span className="text-purple-400 font-bold text-lg">{optResults.fundamental_metrics.optimal_peg}x</span>
                            </div>
                          </div>
                          <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                            <span className="text-gray-500 text-xs block mb-1">Crec. Ingresos (YoY)</span>
                            <div className="flex justify-between items-end">
                              <span className="text-gray-400 line-through text-sm">{optResults.fundamental_metrics.current_rev}%</span>
                              <span className="text-green-400 font-bold text-lg">{optResults.fundamental_metrics.optimal_rev}%</span>
                            </div>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-4 text-center">La IA cruza tu Data Lake local para comparar la solidez de tu cartera actual vs. la optimizada.</p>
                      </div>
                    )}

                    <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg h-80 flex flex-col">
                      <h2 className="text-lg font-bold text-gray-200 mb-1">Proyección a 10 Años</h2>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={projectionData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs><linearGradient id="colorOpt" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10B981" stopOpacity={0}/></linearGradient></defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                          <XAxis dataKey="year" stroke="#9CA3AF" tick={{fontSize: 12}} />
                          <YAxis stroke="#9CA3AF" tickFormatter={(val) => `$${val / 1000}k`} tick={{fontSize: 12}} />
                          <Tooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff' }} formatter={(value: any) => [`$${value.toLocaleString()}`, undefined]} />
                          <Area type="monotone" dataKey="Tu Cartera" stroke="#6B7280" fill="transparent" strokeWidth={2} />
                          <Area type="monotone" dataKey="Markowitz + IA" stroke="#10B981" fill="url(#colorOpt)" strokeWidth={3} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg">
                      <h2 className="text-xl font-bold text-gray-200 mb-6">Plan de Acción Ejecutivo</h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                          <h3 className="text-red-400 font-bold mb-3 border-b border-red-900 pb-2">VENDER / REDUCIR</h3>
                          <ul className="space-y-3">
                            {optResults.rebalance_orders.filter((o: any) => o.action === "VENDER").map((order: any, idx: number) => (
                              <li key={idx} className="flex justify-between items-center text-sm"><span className="font-bold text-gray-300">{order.asset}</span><span className="text-gray-400">Vender <span className="text-red-400 font-bold">{order.delta_pct}%</span></span></li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h3 className="text-green-400 font-bold mb-3 border-b border-green-900 pb-2">COMPRAR / SUMAR</h3>
                          <ul className="space-y-3">
                            {optResults.rebalance_orders.filter((o: any) => o.action === "COMPRAR").map((order: any, idx: number) => (
                              <li key={idx} className="flex justify-between items-center text-sm"><span className="font-bold text-gray-300">{order.asset}</span><span className="text-gray-400">Comprar <span className="text-green-400 font-bold">{order.delta_pct}%</span></span></li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="h-full border-2 border-dashed border-gray-800 rounded-xl flex flex-col items-center justify-center text-gray-500 p-10 text-center">
                    <span className="text-4xl mb-3 opacity-20">📊</span>
                    <p>Carga el archivo del broker de tu cliente, o ingresa los tickers a la izquierda para visualizar la proyección de su dinero a 10 años.</p>
                  </div>
                )}
              </div>
           </div>
        )}

        {/* ================= VISTA SCREENER ================= */}
        {activeTab === 'screener' && (
          <div className="bg-gray-900 p-6 rounded-b-xl rounded-tr-xl border border-gray-800 shadow-lg animate-fade-in min-h-[500px]">
            {screenLoading && screenerData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-emerald-500"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mb-4"></div><p>Cruzando métricas institucionales...</p></div>
            ) : screenError ? (
               <div className="bg-red-950/30 border border-red-900 text-red-400 p-10 rounded-xl text-center"><span className="text-3xl block mb-2">⚠️</span>{screenError}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {groupedScreenerData.map((asset, index) => (
                  <div key={index} className="bg-gray-950 border border-gray-800 rounded-xl p-5 hover:border-gray-600 transition-colors shadow-lg relative flex flex-col justify-between">
                    <div className={`absolute top-0 right-0 text-xs px-3 py-1 font-bold rounded-bl-lg ${asset.recommendation === 'COMPRA FUERTE' ? 'bg-emerald-600 text-white' : asset.recommendation === 'COMPRAR' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
                      {asset.recommendation}
                    </div>
                    <div>
                      <div className="mb-4">
                        <h3 className="text-2xl font-black text-white">{asset.ticker}</h3>
                        <p className="text-xs text-gray-500 uppercase font-bold tracking-wider">{asset.sector}</p>
                      </div>
                      {renderDynamicMetrics(asset)}
                    </div>
                    <div className="mt-4 pt-3 border-t border-gray-800 flex justify-between items-center">
                      <span className="text-gray-400 text-sm">Sentimiento de Mercado (IA)</span>
                      <span className={`font-mono font-bold px-2 py-0.5 rounded text-xs ${asset.ai_score > 0.1 ? 'bg-emerald-900/50 text-emerald-400' : asset.ai_score < -0.1 ? 'bg-red-900/50 text-red-400' : 'bg-gray-800 text-gray-400'}`}>Score: {asset.ai_score.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </main>
  );
}