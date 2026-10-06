"use client";

import { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
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
        body: JSON.stringify({ nro_cuenta: newAccName, aum_total: aum })
      });
      setNewAccName(''); setNewAccAUM('');
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

  // SEMÁFORO CRM
  const getAlertStatus = (acc: any) => {
    if (acc.aum_total == 0) return { color: 'bg-gray-200 text-gray-900 border-gray-400', badge: 'PROSPECTO', msg: 'Capital $0. Nutrición mensual.', filterKey: 'prospect' };
    const days = (new Date().getTime() - new Date(acc.fecha_ultima_interaccion).getTime()) / (1000 * 3600 * 24);
    if (days > 30) return { color: 'bg-red-900/50 text-red-400 border-red-500', badge: 'CRÍTICA', msg: `>30 días sin contacto (${Math.round(days)}d)`, filterKey: 'red' };
    if (days > 15) return { color: 'bg-yellow-900/50 text-yellow-400 border-yellow-500', badge: 'ATENCIÓN', msg: `>15 días sin contacto (${Math.round(days)}d)`, filterKey: 'yellow' };
    return { color: 'bg-emerald-900/50 text-emerald-400 border-emerald-500', badge: 'AL DÍA', msg: `Contacto reciente (${Math.round(days)}d)`, filterKey: 'green' };
  };

  const filteredAccounts = crmAccounts.filter(acc => {
    if (crmFilter === 'all') return true;
    return getAlertStatus(acc).filterKey === crmFilter;
  });

  return (
    <main className="min-h-screen bg-gray-950 text-white p-10 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* HEADER */}
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
            <button onClick={() => setActiveTab('model')} className={`px-6 py-2 rounded-t-lg font-bold transition-colors ${activeTab === 'model' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-800 border-t border-gray-800'}`}>⭐ Cartera Estratégica</button>
            <button onClick={() => setActiveTab('optimizer')} className={`px-6 py-2 rounded-t-lg font-bold transition-colors ${activeTab === 'optimizer' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-800 border-t border-gray-800'}`}>📊 Optimizador Dual</button>
            <button onClick={() => setActiveTab('screener')} className={`px-6 py-2 rounded-t-lg font-bold transition-colors ${activeTab === 'screener' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-800 border-t border-gray-800'}`}>🔎 Screener de Mercado</button>
            <button onClick={() => setActiveTab('crm')} className={`px-6 py-2 rounded-t-lg font-bold transition-colors ${activeTab === 'crm' ? 'bg-emerald-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-800 border-t border-gray-800'}`}>💼 CRM Wealth</button>
          </div>
        </div>

        {/* ================= VISTA CRM WEALTH ================= */}
        {activeTab === 'crm' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in min-h-[600px]">
            {/* PANEL IZQUIERDO: DIRECTORIO */}
            <div className="lg:col-span-1 bg-gray-900 p-6 rounded-b-xl rounded-tr-xl border border-gray-800 shadow-lg flex flex-col h-full">
              <h2 className="text-xl font-bold text-gray-200 mb-4">Directorio de Cuentas</h2>
              
              <div className="flex gap-2 mb-4">
                <input type="text" value={newAccName} onChange={e=>setNewAccName(e.target.value)} placeholder="Ej: ACC-1024" className="w-1/2 bg-gray-950 border border-gray-700 text-white px-2 py-1 text-sm rounded"/>
                <input type="number" value={newAccAUM} onChange={e=>setNewAccAUM(e.target.value)} placeholder="AUM (USD)" className="w-1/4 bg-gray-950 border border-gray-700 text-white px-2 py-1 text-sm rounded"/>
                <button onClick={createAccount} className="w-1/4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded">Crear</button>
              </div>

              <div className="flex gap-1 mb-4 bg-gray-950 p-1 rounded-lg border border-gray-800 overflow-x-auto text-[10px] font-bold">
                <button onClick={()=>setCrmFilter('all')} className={`px-2 py-1 rounded ${crmFilter==='all' ? 'bg-gray-700 text-white' : 'text-gray-500'}`}>TODOS</button>
                <button onClick={()=>setCrmFilter('red')} className={`px-2 py-1 rounded ${crmFilter==='red' ? 'bg-red-900 text-red-200' : 'text-gray-500'}`}>ALERTA ROJA</button>
                <button onClick={()=>setCrmFilter('yellow')} className={`px-2 py-1 rounded ${crmFilter==='yellow' ? 'bg-yellow-900 text-yellow-200' : 'text-gray-500'}`}>SEGUIMIENTO</button>
                <button onClick={()=>setCrmFilter('prospect')} className={`px-2 py-1 rounded ${crmFilter==='prospect' ? 'bg-gray-200 text-gray-900' : 'text-gray-500'}`}>PROSPECTOS</button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {filteredAccounts.map(acc => {
                  const status = getAlertStatus(acc);
                  return (
                    <div key={acc.id} onClick={() => { setSelectedAccount(acc); fetchEvents(acc.id); }} className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedAccount?.id === acc.id ? 'border-blue-500 bg-gray-800' : 'border-gray-800 bg-gray-950 hover:border-gray-600'}`}>
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-bold text-white text-sm">{acc.nro_cuenta}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold ${status.color}`}>{status.badge}</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>AUM: ${acc.aum_total.toLocaleString()}</span>
                        <span>{status.msg}</span>
                      </div>
                    </div>
                  );
                })}
                {filteredAccounts.length === 0 && <p className="text-center text-gray-600 text-sm py-10">No hay cuentas en este filtro.</p>}
              </div>
            </div>

            {/* PANEL DERECHO: EXPEDIENTE CLIENTE */}
            <div className="lg:col-span-2 bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg flex flex-col">
              {!selectedAccount ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-600">
                  <span className="text-5xl mb-4">🗂️</span>
                  <p>Selecciona o crea una cuenta en el panel izquierdo.</p>
                </div>
              ) : (
                <div className="h-full flex flex-col">
                  {/* CABECERA EXPEDIENTE */}
                  <div className="flex justify-between items-start border-b border-gray-800 pb-4 mb-6">
                    <div>
                      <h2 className="text-3xl font-black text-white">{selectedAccount.nro_cuenta}</h2>
                      <p className="text-gray-400 text-sm mt-1">Capital: <span className="font-bold text-emerald-400">${selectedAccount.aum_total.toLocaleString()} USD</span> | Perfil: {selectedAccount.perfil_riesgo}</p>
                    </div>
                    <div className={`px-3 py-1 rounded text-xs font-bold border ${getAlertStatus(selectedAccount).color}`}>
                      Estado: {getAlertStatus(selectedAccount).badge}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full">
                    {/* BITÁCORA */}
                    <div className="flex flex-col h-full border border-gray-800 rounded-lg p-4 bg-gray-950">
                      <h3 className="text-emerald-400 font-bold mb-3 border-b border-emerald-900/50 pb-2">Registro de Actividad</h3>
                      <div className="flex gap-2 mb-4">
                        <select value={newEventType} onChange={e=>setNewEventType(e.target.value)} className="bg-gray-900 border border-gray-700 text-xs rounded px-2 text-white">
                          <option>Llamada</option><option>WhatsApp</option><option>Licitación</option><option>Rebalanceo</option>
                        </select>
                        <input type="text" value={newEventDesc} onChange={e=>setNewEventDesc(e.target.value)} placeholder="Añadir nota..." className="flex-1 bg-gray-900 border border-gray-700 text-xs rounded px-2 py-1.5 text-white"/>
                        <button onClick={createEvent} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs font-bold">+</button>
                      </div>
                      <div className="flex-1 overflow-y-auto space-y-3">
                        {crmEvents.map(ev => (
                          <div key={ev.id} className="bg-gray-900 p-2 rounded border border-gray-800 text-sm">
                            <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                              <span className="font-bold text-blue-400">{ev.tipo_evento}</span>
                              <span>{new Date(ev.fecha_evento).toLocaleDateString()}</span>
                            </div>
                            <p className="text-gray-300 text-xs">{ev.descripcion}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* VINCULACIÓN AL OPTIMIZADOR */}
                    <div className="flex flex-col h-full border border-gray-800 rounded-lg p-4 bg-gray-950">
                      <h3 className="text-blue-400 font-bold mb-3 border-b border-blue-900/50 pb-2">Gestión de Cartera (Renta Variable)</h3>
                      <p className="text-xs text-gray-400 mb-4">Sube el archivo Excel de esta cuenta (Columnas: Ticker, Nominales, Peso %, Precio USD). Esto habilitará el análisis P&L y el pase directo al Optimizador.</p>
                      
                      <div className="border-2 border-dashed border-gray-700 rounded-lg flex flex-col items-center justify-center p-6 bg-gray-900 text-center mb-4">
                        <span className="text-2xl mb-2">📄</span>
                        <p className="text-xs text-gray-400 font-bold">Función en construcción (Paso 14)</p>
                        <p className="text-[10px] text-gray-500 mt-1">Acá conectaremos tu Excel con la base segura de Supabase.</p>
                      </div>

                      <button onClick={() => setActiveTab('optimizer')} className="w-full mt-auto bg-gray-800 hover:bg-gray-700 text-white text-sm font-bold py-3 rounded-lg border border-gray-700 transition-colors shadow-lg flex items-center justify-center gap-2">
                        <span>📊</span> Ir al Optimizador Libre
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ... (RESTAR OF TABS: MODEL, OPTIMIZER, SCREENER remain unchanged from previous step) ... */}
      </div>
    </main>
  );
}