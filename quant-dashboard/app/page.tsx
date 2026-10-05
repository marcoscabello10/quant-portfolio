"use client";

import { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import * as XLSX from 'xlsx';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'optimizer' | 'screener' | 'model'>('model');

  // ================= ESTADOS =================
  const [portfolio, setPortfolio] = useState([
    { ticker: 'AAPL', weight: '30' },
    { ticker: 'MRK', weight: '0.05' },
    { ticker: 'BRKB', weight: '4.81' },
  ]);
  
  // NUEVO ESTADO: Peso Mínimo Core Override
  const [coreMinOverride, setCoreMinOverride] = useState<string>('');
  
  const [optResults, setOptResults] = useState<any>(null);
  const [optLoading, setOptLoading] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);
  const [viewActionPlan, setViewActionPlan] = useState<'standard' | 'cs'>('cs');

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
      data.push({
        period: i === 0 ? "-36m" : i === 36 ? "Hoy" : `-${36 - i}m`,
        "Estrategia Quant": Math.round(start_capital * Math.pow(1 + r_quant, i/12)),
        "S&P 500 (SPY)": Math.round(start_capital * Math.pow(1 + r_spy, i/12))
      });
    }
    return data;
  };

  const generateComparisonData = () => {
    if (!optResults) return [];
    const allTickers = Array.from(new Set([
      ...Object.keys(optResults.current_weights || {}),
      ...Object.keys(optResults.optimal_weights || {}),
      ...Object.keys(optResults.cs_optimal_weights || {})
    ]));
    return allTickers.map(ticker => ({
      ticker,
      "Actual %": optResults.current_weights[ticker] || 0,
      "Estándar %": optResults.optimal_weights[ticker] || 0,
      "Core-Satellite %": optResults.cs_optimal_weights[ticker] || 0
    })).sort((a, b) => b["Core-Satellite %"] - a["Core-Satellite %"]);
  };

  const projectionData = generateProjectionData();
  const backtestData = generateBacktestData();
  const comparisonData = generateComparisonData();

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
            <button onClick={() => setActiveTab('optimizer')} className={`px-6 py-2 rounded-t-lg font-bold transition-colors ${activeTab === 'optimizer' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-800 border-t border-l border-r border-gray-800'}`}>📊 Optimizador Dual (Quants vs Core)</button>
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
                          <RechartsTooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff' }} formatter={(value: any) => [`$${value.toLocaleString()}`, undefined]} />
                          <Area type="monotone" dataKey="S&P 500 (SPY)" stroke="#6B7280" fill="transparent" strokeWidth={2} />
                          <Area type="monotone" dataKey="Estrategia Quant" stroke="#10B981" fill="url(#colorQuant)" strokeWidth={3} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

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

        {/* ================= VISTA OPTIMIZADOR DUAL ================= */}
        {activeTab === 'optimizer' && (
           <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in">
              <div className="lg:col-span-1 bg-gray-900 p-6 rounded-b-xl rounded-tr-xl border border-gray-800 shadow-lg h-fit">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold text-gray-200">Cartera Cliente</h2>
                  <span className={`text-sm font-bold px-2 py-1 rounded ${totalWeight >= 99.9 ? 'bg-emerald-900 text-emerald-400' : 'bg-blue-900 text-blue-400'}`}>
                    Suma: {totalWeight.toFixed(2)}%
                  </span>
                </div>
                
                <div className="flex gap-2 mb-4">
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
                          Peso: <span className="text-emerald-500">{normalizedWeight.toFixed(2)}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* OVERRIDE MANUAL PARA EL PESO CORE */}
                <div className="bg-emerald-950/20 p-3 rounded-lg border border-emerald-900/50 mb-6">
                  <label className="text-xs text-emerald-400 font-bold mb-2 flex justify-between">
                    <span>🛡️ Peso Mínimo por Activo Core (%)</span>
                    <span className="text-gray-500 font-normal">Opcional</span>
                  </label>
                  <input 
                    type="number" 
                    placeholder="Ej: 15 (Dejar vacío para Automático)" 
                    value={coreMinOverride} 
                    onChange={(e) => setCoreMinOverride(e.target.value)} 
                    className="w-full bg-gray-900 border border-gray-700 rounded text-white focus:border-emerald-500 text-sm px-3 py-2 placeholder-gray-600"
                  />
                  <p className="text-[10px] text-gray-500 mt-1">Obliga al algoritmo a darle este peso a tus mejores activos.</p>
                </div>

                <button onClick={runOptimizer} disabled={optLoading} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 text-white font-bold py-3 rounded-lg transition-colors shadow-lg">
                  {optLoading ? "Calculando Estrategias..." : "Simular Escenarios (Dual)"}
                </button>
                {optError && <p className="text-red-400 mt-3 text-sm text-center font-bold bg-red-900/20 p-2 rounded">{optError}</p>}
              </div>

              <div className="lg:col-span-2 space-y-6">
                {optResults && optResults.current_performance_metrics ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg">
                        <h3 className="text-gray-400 text-xs mb-4">CARTERA ACTUAL</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between"><span className="text-gray-500">Rendimiento:</span><span className="text-lg font-bold">{optResults.current_performance_metrics.expected_annual_return_pct}%</span></div>
                          <div className="flex justify-between"><span className="text-gray-500">Volatilidad:</span><span className="text-lg font-bold text-orange-400">{optResults.current_performance_metrics.annual_volatility_pct}%</span></div>
                          <div className="flex justify-between border-t border-gray-800 pt-2"><span className="text-gray-500">Sharpe Ratio:</span><span className="text-sm font-bold text-gray-400">{optResults.current_performance_metrics.sharpe_ratio}</span></div>
                        </div>
                      </div>
                      
                      <div className="bg-gray-900 p-6 rounded-xl border border-blue-900 shadow-lg">
                        <h3 className="text-blue-400 text-xs mb-4 font-bold">MARKOWITZ ESTÁNDAR (Riesgo Min)</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between"><span className="text-gray-400">Rendimiento:</span><span className="text-lg font-bold text-blue-400">{optResults.performance_metrics.expected_annual_return_pct}%</span></div>
                          <div className="flex justify-between"><span className="text-gray-400">Volatilidad:</span><span className="text-lg font-bold text-blue-400">{optResults.performance_metrics.annual_volatility_pct}%</span></div>
                          <div className="flex justify-between border-t border-gray-800 pt-2"><span className="text-gray-400">Sharpe Ratio:</span><span className="text-sm font-bold text-blue-300">{optResults.performance_metrics.sharpe_ratio}</span></div>
                        </div>
                      </div>

                      <div className="bg-emerald-900/20 p-6 rounded-xl border border-emerald-500 shadow-lg relative overflow-hidden">
                        <div className="absolute top-0 right-0 bg-emerald-600 text-[10px] px-2 py-1 rounded-bl font-bold text-white">RECOMENDADO</div>
                        <h3 className="text-emerald-400 text-xs mb-4 font-bold">CORE-SATELLITE (Alta Convicción)</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between"><span className="text-gray-400">Rendimiento:</span><span className="text-lg font-bold text-emerald-400">{optResults.cs_performance_metrics.expected_annual_return_pct}%</span></div>
                          <div className="flex justify-between"><span className="text-gray-400">Volatilidad:</span><span className="text-lg font-bold text-emerald-400">{optResults.cs_performance_metrics.annual_volatility_pct}%</span></div>
                          <div className="flex justify-between border-t border-gray-800 pt-2"><span className="text-gray-400">Sharpe Ratio:</span><span className="text-sm font-bold text-emerald-300">{optResults.cs_performance_metrics.sharpe_ratio}</span></div>
                        </div>
                        <p className="text-[10px] text-emerald-500/70 mt-3">Suelo ({optResults.applied_core_min_weight}%) protegido para: {optResults.cs_performance_metrics.core_assets.join(', ')}</p>
                      </div>
                    </div>

                    {optResults.fundamental_metrics && (
                      <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg">
                        <h2 className="text-lg font-bold text-gray-200 mb-4 flex items-center gap-2">
                          <span className="text-xl">🧬</span> Matriz Fundamental Comparativa
                        </h2>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                            <span className="text-gray-500 text-xs block mb-2 border-b border-gray-800 pb-1">P/E Promedio</span>
                            <div className="text-[11px] text-gray-500 flex justify-between">Actual: <span className="text-white">{optResults.fundamental_metrics.current_pe}x</span></div>
                            <div className="text-[11px] text-gray-500 flex justify-between">Estándar: <span className="text-blue-400">{optResults.fundamental_metrics.optimal_pe}x</span></div>
                            <div className="text-[11px] text-gray-500 flex justify-between font-bold">Core-Sat: <span className="text-emerald-400">{optResults.fundamental_metrics.cs_pe}x</span></div>
                          </div>
                          <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                            <span className="text-gray-500 text-xs block mb-2 border-b border-gray-800 pb-1">Crecimiento Ingresos (YoY)</span>
                            <div className="text-[11px] text-gray-500 flex justify-between">Actual: <span className="text-white">{optResults.fundamental_metrics.current_rev}%</span></div>
                            <div className="text-[11px] text-gray-500 flex justify-between">Estándar: <span className="text-blue-400">{optResults.fundamental_metrics.optimal_rev}%</span></div>
                            <div className="text-[11px] text-gray-500 flex justify-between font-bold">Core-Sat: <span className="text-emerald-400">{optResults.fundamental_metrics.cs_rev}%</span></div>
                          </div>
                          <div className="bg-gray-950 p-4 rounded-lg border border-gray-800">
                            <span className="text-gray-500 text-xs block mb-2 border-b border-gray-800 pb-1">ROE Promedio</span>
                            <div className="text-[11px] text-gray-500 flex justify-between">Actual: <span className="text-white">{optResults.fundamental_metrics.current_roe}%</span></div>
                            <div className="text-[11px] text-gray-500 flex justify-between">Estándar: <span className="text-blue-400">{optResults.fundamental_metrics.optimal_roe}%</span></div>
                            <div className="text-[11px] text-gray-500 flex justify-between font-bold">Core-Sat: <span className="text-emerald-400">{optResults.fundamental_metrics.cs_roe}%</span></div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg">
                      <h3 className="text-lg font-bold text-gray-300 mb-4">Transición de Pesos en Cartera</h3>
                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={comparisonData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                            <XAxis dataKey="ticker" stroke="#9CA3AF" tick={{fontSize: 10}} interval={0} />
                            <YAxis stroke="#9CA3AF" tickFormatter={(val) => `${val}%`} tick={{fontSize: 10}} />
                            <RechartsTooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff' }} formatter={(val) => `${val}%`} />
                            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                            <Bar dataKey="Actual %" fill="#4B5563" radius={[2, 2, 0, 0]} />
                            <Bar dataKey="Estándar %" fill="#3B82F6" radius={[2, 2, 0, 0]} />
                            <Bar dataKey="Core-Satellite %" fill="#10B981" radius={[2, 2, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg h-80 flex flex-col">
                      <h2 className="text-lg font-bold text-gray-200 mb-1">Proyección a 10 Años (Triple Escenario)</h2>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={projectionData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorCS" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10B981" stopOpacity={0}/></linearGradient>
                            <linearGradient id="colorStd" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2}/><stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/></linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                          <XAxis dataKey="year" stroke="#9CA3AF" tick={{fontSize: 12}} />
                          <YAxis stroke="#9CA3AF" tickFormatter={(val) => `$${val / 1000}k`} tick={{fontSize: 12}} />
                          <RechartsTooltip contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#fff' }} formatter={(value: any) => [`$${value.toLocaleString()}`, undefined]} />
                          <Area type="monotone" dataKey="Tu Cartera" stroke="#6B7280" fill="transparent" strokeWidth={2} />
                          <Area type="monotone" dataKey="Markowitz Estándar" stroke="#3B82F6" fill="url(#colorStd)" strokeWidth={2} />
                          <Area type="monotone" dataKey="Core-Satellite (Recomendada)" stroke="#10B981" fill="url(#colorCS)" strokeWidth={3} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg">
                      <div className="flex justify-between items-center mb-6 border-b border-gray-800 pb-4">
                        <h2 className="text-xl font-bold text-gray-200">Plan de Acción Ejecutivo</h2>
                        <div className="flex bg-gray-950 rounded-lg p-1 border border-gray-800">
                          <button onClick={() => setViewActionPlan('cs')} className={`px-4 py-1 text-xs font-bold rounded ${viewActionPlan === 'cs' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:text-white'}`}>Core-Satellite</button>
                          <button onClick={() => setViewActionPlan('standard')} className={`px-4 py-1 text-xs font-bold rounded ${viewActionPlan === 'standard' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'}`}>Estándar</button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                          <h3 className="text-red-400 font-bold mb-3 border-b border-red-900 pb-2">VENDER / REDUCIR</h3>
                          <ul className="space-y-3">
                            {(viewActionPlan === 'cs' ? optResults.cs_rebalance_orders : optResults.rebalance_orders)
                              .filter((o: any) => o.action === "VENDER").map((order: any, idx: number) => (
                              <li key={idx} className="flex justify-between items-center text-sm">
                                <span className="font-bold text-gray-300">{order.asset}</span>
                                <span className="text-gray-400">Vender <span className="text-red-400 font-bold">{order.delta_pct}%</span></span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h3 className="text-green-400 font-bold mb-3 border-b border-green-900 pb-2">COMPRAR / SUMAR</h3>
                          <ul className="space-y-3">
                            {(viewActionPlan === 'cs' ? optResults.cs_rebalance_orders : optResults.rebalance_orders)
                              .filter((o: any) => o.action === "COMPRAR").map((order: any, idx: number) => (
                              <li key={idx} className="flex justify-between items-center text-sm">
                                <span className="font-bold text-gray-300">
                                  {order.asset} {order.is_core && <span className="ml-2 text-[9px] bg-emerald-900/50 text-emerald-400 px-1 py-0.5 rounded border border-emerald-800">CORE</span>}
                                </span>
                                <span className="text-gray-400">Comprar <span className="text-green-400 font-bold">{order.delta_pct}%</span></span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="h-full border-2 border-dashed border-gray-800 rounded-xl flex flex-col items-center justify-center text-gray-500 p-10 text-center">
                    <span className="text-4xl mb-3 opacity-20">📊</span>
                    <p>Sube el Excel de tu cliente y compara la optimización Matemática vs Institucional.</p>
                  </div>
                )}
              </div>
           </div>
        )}
      </div>
    </main>
  );
}