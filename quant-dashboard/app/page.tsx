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