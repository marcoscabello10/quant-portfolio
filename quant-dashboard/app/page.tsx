"use client";

import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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

  const [modelPortfolio, setModelPortfolio] = useState<any>(null);
  const [modelLoading, setModelLoading] = useState(false);

  // ================= FUNCIONES AUXILIARES =================
  const parseWeight = (val: string) => { const parsed = parseFloat(val); return isNaN(parsed) ? 0 : parsed; };
  const totalWeight = portfolio.reduce((acc, item) => acc + parseWeight(item.weight), 0);
  const addAsset = () => setPortfolio([...portfolio, { ticker: '', weight: '' }]);
  const updateAsset = (index: number, field: string, value: any) => {
    const newPortfolio = [...portfolio]; newPortfolio[index] = { ...newPortfolio[index], [field]: value }; setPortfolio(newPortfolio);
  };
  const removeAsset = (index: number) => setPortfolio(portfolio.filter((_, i) => i !== index));

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
      if (!res.ok) throw new Error(data.detail || "Error en servidor");
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
      setScreenerData(data.top_picks || []);
    } catch (err) {}
    setScreenLoading(false);
  };

  const runModelPortfolio = async () => {
    if (modelPortfolio) return;
    setModelLoading(true);
    try {
      const res = await fetch('https://quant-api-3778.onrender.com/api/v1/model_portfolio');
      const data = await res.json();
      setModelPortfolio(data);
    } catch (err) {}
    setModelLoading(false);
  };

  useEffect(() => {
    if (activeTab === 'screener') runScreener();
    if (activeTab === 'model') runModelPortfolio();
  }, [activeTab]);

  const groupedScreenerData = [...screenerData].sort((a, b) => {
    if ((a.sector || "") < (b.sector || "")) return -1;
    if ((a.sector || "") > (b.sector || "")) return 1;
    return (b.ai_score || 0) - (a.ai_score || 0);
  });

  // ================= FORMATOS DE MÉTRICAS (6 POR TARJETA) =================
  const formatPct = (val: any) => {
    if (val == null) return 'N/A';
    const num = parseFloat(val);
    return (num > 1 || num < -1) ? `${num.toFixed(1)}%` : `${(num * 100).toFixed(1)}%`;
  };
  const formatNum = (val: any) => val != null ? parseFloat(val).toFixed(2) : 'N/A';
  const formatBil = (val: any) => val != null ? `$${(parseFloat(val) / 1e9).toFixed(1)}B` : 'N/A'; // Formato en Billones

  const renderDynamicMetrics = (asset: any) => {
    const sector = asset.sector || "";
    
    // GROWTH: Gross Margin & Free Cash Flow reemplazan a ROE
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
    } 
    // FINANCIALS: Sumamos Payout Ratio para ver si el dividendo está en riesgo
    else if (["Financial Services"].includes(sector)) {
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
    } 
    // CAPITAL INTENSIVO: Agregamos Operating Cash Flow
    else if (["Energy", "Industrials", "Basic Materials"].includes(sector)) {
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
    }
    // VALUE / DEFENSIVO: Payout Ratio en lugar de PE Forward
    else {
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
        
        {/* ENCABEZADO */}
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
            <button onClick={() => setActiveTab('model')} className={`px-6 py-2 rounded-t-lg font-bold transition-colors ${activeTab === 'model' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-800 border-t border-l border-r border-gray-800'}`}>⭐ Cartera Modelo</button>
            <button onClick={() => setActiveTab('optimizer')} className={`px-6 py-2 rounded-t-lg font-bold transition-colors ${activeTab === 'optimizer' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-800 border-t border-l border-r border-gray-800'}`}>📊 Optimizador de Cartera</button>
            <button onClick={() => setActiveTab('screener')} className={`px-6 py-2 rounded-t-lg font-bold transition-colors ${activeTab === 'screener' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-800 border-t border-l border-r border-gray-800'}`}>🔎 Screener Institucional</button>
          </div>
        </div>

        {/* ================= VISTA CARTERA MODELO (NUEVA) ================= */}
        {activeTab === 'model' && (
          <div className="animate-fade-in space-y-6">
            <div className="bg-gray-900 p-8 rounded-b-xl rounded-tr-xl border border-gray-800 shadow-lg">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-200">Cartera Estratégica ("New Money")</h2>
                  <p className="text-sm text-gray-400 mt-1">Generada automáticamente maximizando el Ratio de Sharpe sobre los mejores activos del Data Lake.</p>
                </div>
                <button onClick={() => { setModelPortfolio(null); runModelPortfolio(); }} className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2 rounded-lg text-sm">
                  {modelLoading ? "Calculando Frontera..." : "↻ Recalcular Estrategia"}
                </button>
              </div>

              {modelLoading && !modelPortfolio ? (
                 <div className="flex justify-center py-20 text-emerald-500"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div></div>
              ) : modelPortfolio && !modelPortfolio.error ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                  {/* Comparativa con SPY */}
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
                    <div className="bg-gray-950 p-6 rounded-xl border border-gray-800">
                      <h3 className="text-gray-200 font-bold mb-4">Composición del Fondo</h3>
                      <div className="space-y-3">
                        {modelPortfolio.assets.map((asset: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center">
                            <span className="font-bold text-lg">{asset.ticker}</span>
                            <div className="flex items-center gap-3">
                              <div className="w-48 bg-gray-800 h-2 rounded-full overflow-hidden">
                                <div className="bg-emerald-500 h-full" style={{width: `${asset.weight}%`}}></div>
                              </div>
                              <span className="font-mono text-emerald-400 font-bold">{asset.weight}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="bg-gray-950 border border-gray-800 rounded-xl flex items-center justify-center p-10 text-center text-gray-400">
                    <div>
                      <h3 className="text-xl font-bold text-gray-300 mb-2">Alpha Generado</h3>
                      <p>Esta cartera está diseñada para superar al índice S&P 500 asumiendo un nivel de riesgo controlado. Ideal para ofrecer como estrategia base a nuevos inversores.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-red-400 text-center py-10">{modelPortfolio?.error || "Error al generar cartera."}</div>
              )}
            </div>
          </div>
        )}

        {/* ================= VISTAS ANTERIORES (Simplificadas en código por espacio) ================= */}
        {activeTab === 'optimizer' && (
           <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in">
              {/* Aquí va exactamente el mismo código del Optimizador que ya tenías */}
              <div className="lg:col-span-1 bg-gray-900 p-6 rounded-b-xl rounded-tr-xl border border-gray-800 shadow-lg h-fit">
                <button onClick={runOptimizer} disabled={optLoading} className="w-full mt-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 text-white font-bold py-3 rounded-lg transition-colors shadow-lg">
                  {optLoading ? "Calculando..." : "Simular Rebalanceo"}
                </button>
                {/* ... El resto del optimizador ... (Mantén tu código anterior del map de portfolio) */}
              </div>
           </div>
        )}

        {activeTab === 'screener' && (
          <div className="bg-gray-900 p-6 rounded-b-xl rounded-tr-xl border border-gray-800 shadow-lg animate-fade-in min-h-[500px]">
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
          </div>
        )}

      </div>
    </main>
  );
}