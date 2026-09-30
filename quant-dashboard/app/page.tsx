"use client";

import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function Home() {
  // Estado para las pestañas (Tabs)
  const [activeTab, setActiveTab] = useState<'optimizer' | 'screener'>('optimizer');

  // ================= ESTADO: OPTIMIZADOR =================
  const [portfolio, setPortfolio] = useState([
    { ticker: 'AAPL', weight: '30' },
    { ticker: 'MRK', weight: '0.05' },
    { ticker: 'BRKB', weight: '4.81' },
  ]);
  const [optResults, setOptResults] = useState<any>(null);
  const [optLoading, setOptLoading] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);

  // ================= ESTADO: SCREENER =================
  const [screenerData, setScreenerData] = useState<any[]>([]);
  const [screenLoading, setScreenLoading] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);

  // Parseo de comas/puntos
  const parseWeight = (val: string) => {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? 0 : parsed;
  };
  const totalWeight = portfolio.reduce((acc, item) => acc + parseWeight(item.weight), 0);
  const addAsset = () => setPortfolio([...portfolio, { ticker: '', weight: '' }]);
  const updateAsset = (index: number, field: string, value: any) => {
    const newPortfolio = [...portfolio];
    newPortfolio[index] = { ...newPortfolio[index], [field]: value };
    setPortfolio(newPortfolio);
  };
  const removeAsset = (index: number) => {
    setPortfolio(portfolio.filter((_, i) => i !== index));
  };

  // Función para ejecutar el Optimizador
  const runOptimizer = async () => {
    setOptLoading(true);
    setOptError(null);
    setOptResults(null);
    
    try {
      const payload: Record<string, number> = {};
      portfolio.forEach(item => {
        if (item.ticker.trim() !== '') {
          payload[item.ticker.trim().toUpperCase()] = parseWeight(item.weight);
        }
      });
      if (Object.keys(payload).length < 2) throw new Error("Requiere al menos 2 activos.");

      const res = await fetch('https://quant-api-3778.onrender.com/api/v1/portfolio/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_portfolio: payload })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Error en el servidor Quant");
      setOptResults(data);
    } catch (err: any) {
      setOptError(err.message);
    }
    setOptLoading(false);
  };

  // Función para ejecutar el Screener
  const runScreener = async () => {
    if (screenerData.length > 0) return; // Si ya hay datos, no recarga para ahorrar API
    
    setScreenLoading(true);
    setScreenError(null);
    try {
      const res = await fetch('https://quant-api-3778.onrender.com/api/v1/screener');
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Error escaneando el mercado");
      setScreenerData(data.top_picks || []);
    } catch (err: any) {
      setScreenError(err.message);
    }
    setScreenLoading(false);
  };

  // Cuando se abre la pestaña Screener, carga automáticamente
  useEffect(() => {
    if (activeTab === 'screener') {
      runScreener();
    }
  }, [activeTab]);

  // Gráfico a 10 años
  const generateProjectionData = () => {
    if (!optResults || !optResults.current_performance_metrics) return [];
    const data = [];
    let currentVal = 10000;
    let optimalVal = 10000;
    const r_curr = optResults.current_performance_metrics.expected_annual_return_pct / 100;
    const r_opt = optResults.performance_metrics.expected_annual_return_pct / 100;

    for(let i = 0; i <= 10; i++) {
      data.push({
        year: `Año ${i}`,
        "Tu Cartera": Math.round(currentVal),
        "Markowitz + IA": Math.round(optimalVal)
      });
      currentVal *= (1 + r_curr);
      optimalVal *= (1 + r_opt);
    }
    return data;
  };
  const projectionData = generateProjectionData();

  return (
    <main className="min-h-screen bg-gray-950 text-white p-10 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* ENCABEZADO Y TABS */}
        <div className="border-b border-gray-800 pb-6">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h1 className="text-4xl font-bold text-emerald-500 mb-1">Quant IA Platform</h1>
              <p className="text-gray-400">Terminal Institucional de Gestión de Carteras</p>
            </div>
            <div className="text-xs text-gray-500 font-mono text-right">
              STATUS: <span className="text-emerald-400 font-bold">ONLINE</span><br/>
              NODE: render-api-3778
            </div>
          </div>
          
          <div className="flex gap-4 mt-6">
            <button 
              onClick={() => setActiveTab('optimizer')} 
              className={`px-6 py-2 rounded-t-lg font-bold transition-colors ${activeTab === 'optimizer' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-800 border-t border-l border-r border-gray-800'}`}
            >
              📊 Optimizador de Cartera
            </button>
            <button 
              onClick={() => setActiveTab('screener')} 
              className={`px-6 py-2 rounded-t-lg font-bold transition-colors ${activeTab === 'screener' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-800 border-t border-l border-r border-gray-800'}`}
            >
              🔎 Screener de Mercado
            </button>
          </div>
        </div>

        {/* ================= VISTA OPTIMIZADOR ================= */}
        {activeTab === 'optimizer' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in">
            <div className="lg:col-span-1 bg-gray-900 p-6 rounded-b-xl rounded-tr-xl border border-gray-800 shadow-lg h-fit">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-200">Cartera Cliente</h2>
                <span className={`text-sm font-bold px-2 py-1 rounded ${totalWeight >= 99.9 ? 'bg-emerald-900 text-emerald-400' : 'bg-blue-900 text-blue-400'}`}>
                  Suma: {totalWeight.toFixed(2)}%
                </span>
              </div>

              <div className="space-y-3 mb-6">
                {portfolio.map((item, index) => {
                  const numWeight = parseWeight(item.weight);
                  const normalizedWeight = totalWeight > 0 ? (numWeight / totalWeight) * 100 : 0;
                  return (
                    <div key={index} className="flex flex-col gap-1 bg-gray-950 p-2 rounded-lg border border-gray-800">
                      <div className="flex gap-2">
                        <input type="text" value={item.ticker} onChange={(e) => updateAsset(index, 'ticker', e.target.value)} className="w-1/2 bg-gray-900 border border-gray-700 rounded text-white focus:border-emerald-500 uppercase text-sm px-2" placeholder="Ticker" />
                        <div className="w-1/2 flex relative">
                          <input type="text" value={item.weight} onChange={(e) => updateAsset(index, 'weight', e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded text-white focus:border-emerald-500 pr-6 text-sm px-2" placeholder="0.00" />
                          <span className="absolute right-2 top-1 text-gray-500 text-sm">%</span>
                        </div>
                        <button onClick={() => removeAsset(index)} className="text-red-500 hover:text-red-400 px-2 font-bold">✕</button>
                      </div>
                      <div className="text-right text-[10px] text-gray-500 font-mono">
                        Peso en CEDEARs: <span className="text-emerald-500">{normalizedWeight.toFixed(2)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button onClick={addAsset} className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded-lg mb-4 text-sm transition-colors">+ Añadir Activo</button>
              <button onClick={runOptimizer} disabled={optLoading} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 text-white font-bold py-3 rounded-lg transition-colors shadow-lg">
                {optLoading ? "Calculando..." : "Simular Rebalanceo"}
              </button>
              {optError && <p className="text-red-400 mt-3 text-sm text-center">{optError}</p>}
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
                  <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg h-80 flex flex-col">
                    <h2 className="text-lg font-bold text-gray-200 mb-1">Proyección a 10 Años</h2>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={projectionData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorOpt" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
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
                            <li key={idx} className="flex justify-between items-center text-sm">
                              <span className="font-bold text-gray-300">{order.asset}</span><span className="text-gray-400">Vender <span className="text-red-400 font-bold">{order.delta_pct}%</span></span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h3 className="text-green-400 font-bold mb-3 border-b border-green-900 pb-2">COMPRAR / SUMAR</h3>
                        <ul className="space-y-3">
                          {optResults.rebalance_orders.filter((o: any) => o.action === "COMPRAR").map((order: any, idx: number) => (
                            <li key={idx} className="flex justify-between items-center text-sm">
                              <span className="font-bold text-gray-300">{order.asset}</span><span className="text-gray-400">Comprar <span className="text-green-400 font-bold">{order.delta_pct}%</span></span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="h-full border-2 border-dashed border-gray-800 rounded-xl flex items-center justify-center text-gray-500 p-10 text-center">Visualiza la proyección de tu dinero a 10 años.</div>
              )}
            </div>
          </div>
        )}

        {/* ================= VISTA SCREENER ================= */}
        {activeTab === 'screener' && (
          <div className="bg-gray-900 p-6 rounded-b-xl rounded-tr-xl border border-gray-800 shadow-lg animate-fade-in min-h-[500px]">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-200">Oportunidades de Inversión</h2>
                <p className="text-sm text-gray-400 mt-1">Escaneo fundamental (ROE, P/E) cruzado con sentimiento FinBERT de noticias.</p>
              </div>
              <button 
                onClick={runScreener} 
                className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-lg text-sm flex items-center gap-2"
              >
                {screenLoading ? "Escaneando..." : "↻ Refrescar Mercado"}
              </button>
            </div>

            {screenLoading && screenerData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-emerald-500">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mb-4"></div>
                <p>Descargando balances y analizando noticias en tiempo real...</p>
                <p className="text-xs text-gray-500 mt-2">(La extracción de Yahoo Finance y la IA puede demorar unos 15-20 segundos)</p>
              </div>
            ) : screenError ? (
              <div className="text-center py-10 text-red-400">{screenError}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {screenerData.map((asset, index) => (
                  <div key={index} className="bg-gray-950 border border-gray-800 rounded-xl p-5 hover:border-gray-600 transition-colors shadow-lg relative overflow-hidden">
                    
                    {/* Badge de Recomendación */}
                    <div className={`absolute top-0 right-0 text-xs px-3 py-1 font-bold rounded-bl-lg
                      ${asset.recommendation === 'COMPRA FUERTE' ? 'bg-emerald-600 text-white' : 
                        asset.recommendation === 'COMPRAR' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
                      {asset.recommendation}
                    </div>

                    <div className="mb-4">
                      <h3 className="text-2xl font-black text-white">{asset.ticker}</h3>
                      <p className="text-xs text-gray-500 uppercase">{asset.sector}</p>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center border-b border-gray-800 pb-2">
                        <span className="text-gray-400 text-sm">ROE (Retorno Cap.)</span>
                        <span className={`font-mono font-bold ${asset.roe_pct > 15 ? 'text-emerald-400' : 'text-white'}`}>
                          {asset.roe_pct}%
                        </span>
                      </div>
                      
                      <div className="flex justify-between items-center border-b border-gray-800 pb-2">
                        <span className="text-gray-400 text-sm">P/E Ratio</span>
                        <span className="font-mono font-bold text-white">
                          {asset.pe_ratio > 0 ? asset.pe_ratio : 'N/A'}
                        </span>
                      </div>

                      <div className="flex justify-between items-center pt-1">
                        <span className="text-gray-400 text-sm">Sentimiento IA</span>
                        <span className={`font-mono font-bold px-2 py-0.5 rounded text-xs
                          ${asset.ai_score > 0.1 ? 'bg-emerald-900/50 text-emerald-400' : 
                            asset.ai_score < -0.1 ? 'bg-red-900/50 text-red-400' : 'bg-gray-800 text-gray-400'}`}>
                          Score: {asset.ai_score.toFixed(2)}
                        </span>
                      </div>
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