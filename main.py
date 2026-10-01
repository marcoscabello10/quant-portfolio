from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict
import yfinance as yf
import pandas as pd
import numpy as np
import sqlite3
from datetime import datetime
import time
import os
import requests
import json
from bs4 import BeautifulSoup
import functools

from pypfopt.expected_returns import mean_historical_return
from pypfopt.risk_models import CovarianceShrinkage
from pypfopt.efficient_frontier import EfficientFrontier
from pypfopt.black_litterman import BlackLittermanModel

from apscheduler.schedulers.background import BackgroundScheduler
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware

DB_NAME = "quant_database.db"
HF_API_TOKEN = os.getenv("HF_API_TOKEN")

TICKER_MAP = {
    "BRKB": "BRK-B",
    "BRK.B": "BRK-B",
    "BFB": "BF-B",
    "BF.B": "BF-B"
}

def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sentiment_history (
            date TEXT,
            ticker TEXT,
            sentiment_score REAL,
            articles_analyzed INTEGER,
            PRIMARY KEY (date, ticker)
        )
    ''')
    conn.commit()
    conn.close()

def get_sentiment_from_api(titles):
    if not titles: return 0
    if not HF_API_TOKEN: return 0
        
    API_URL = "https://api-inference.huggingface.co/models/ProsusAI/finbert"
    headers = {"Authorization": f"Bearer {HF_API_TOKEN}"}
    
    for attempt in range(3):
        try:
            response = requests.post(API_URL, headers=headers, json={"inputs": titles})
            results = response.json()
            
            if isinstance(results, dict) and 'error' in results:
                wait_time = results.get('estimated_time', 15)
                time.sleep(wait_time + 2)
                continue
                
            score_total = 0
            if isinstance(results, list):
                for item in results:
                    if isinstance(item, list) and len(item) > 0:
                        label = item[0]['label']
                        if label == 'positive': score_total += 1
                        elif label == 'negative': score_total -= 1
            return score_total / len(titles)
        except Exception:
            return 0
    return 0

def get_universe_from_file():
    if not os.path.exists("cedears.txt"):
        return ["AAPL", "MSFT", "NVDA", "KO", "JNJ", "V", "BRK-B"]
    with open("cedears.txt", "r") as file:
        return [line.strip().upper() for line in file if line.strip()]

def daily_sentiment_job():
    tickers = get_universe_from_file()
    total = len(tickers)
    today = datetime.now().strftime("%Y-%m-%d")
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    headers = {'User-Agent': 'Mozilla/5.0'}

    for i, ticker in enumerate(tickers, 1):
        try:
            time.sleep(2)
            url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={ticker}&region=US&lang=en-US"
            response = requests.get(url, headers=headers, timeout=10)
            if response.status_code != 200: continue
            soup = BeautifulSoup(response.content, 'xml')
            titles = [item.title.text for item in soup.find_all('item') if item.title][:10]
            if not titles: continue
            
            avg_score = get_sentiment_from_api(titles)

            cursor.execute('''
                INSERT OR REPLACE INTO sentiment_history (date, ticker, sentiment_score, articles_analyzed)
                VALUES (?, ?, ?, ?)
            ''', (today, ticker, avg_score, len(titles)))
        except Exception:
            continue
    conn.commit()
    conn.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    scheduler = BackgroundScheduler()
    scheduler.add_job(daily_sentiment_job, 'cron', day_of_week='mon-fri', hour=18, minute=0)
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(title="Quant Portfolio API", version="5.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class RebalanceRequest(BaseModel):
    current_portfolio: Dict[str, float]

@functools.lru_cache(maxsize=128)
def fetch_historical_data(tickers_tuple: tuple, period: str = "5y"):
    return yf.download(list(tickers_tuple), period=period)['Close']

# ================= 1. OPTIMIZADOR DE CARTERA =================
@app.post("/api/v1/portfolio/optimize")
def optimize_portfolio(request: RebalanceRequest):
    mapped_portfolio = {}
    for k, v in request.current_portfolio.items():
        clean_ticker = k.upper().strip()
        clean_ticker = TICKER_MAP.get(clean_ticker, clean_ticker)
        if clean_ticker != "SPY":
            mapped_portfolio[clean_ticker] = v
            
    user_tickers = list(mapped_portfolio.keys())
    if len(user_tickers) < 2: raise HTTPException(status_code=400, detail="Mínimo 2 activos requeridos.")

    try:
        tickers_tuple = tuple(sorted(user_tickers + ["SPY"]))
        df_all = fetch_historical_data(tickers_tuple).copy()
        
        df_all.dropna(axis=1, how='all', inplace=True) 
        df_all.ffill(inplace=True)
        df_all.dropna(inplace=True) 

        valid_tickers = [t for t in user_tickers if t in df_all.columns]
        if len(valid_tickers) < 2: raise HTTPException(status_code=400, detail="No hay datos históricos suficientes.")

        total_current_weight = sum([mapped_portfolio[t] for t in valid_tickers])
        normalized_current = {t: mapped_portfolio[t] / total_current_weight for t in valid_tickers}

        spy_returns = df_all['SPY'].pct_change().dropna()
        spy_ann_return = spy_returns.mean() * 252
        spy_ann_vol = spy_returns.std() * np.sqrt(252)
        spy_sharpe = (spy_ann_return - 0.02) / spy_ann_vol if spy_ann_vol != 0 else 0

        df_universe = df_all[valid_tickers]
        mu = mean_historical_return(df_universe)
        S = CovarianceShrinkage(df_universe).ledoit_wolf()
        
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        views_dict = {}
        for ticker in valid_tickers:
            cursor.execute('SELECT AVG(sentiment_score) FROM sentiment_history WHERE ticker = ?', (ticker,))
            row = cursor.fetchone()
            score = row[0] if row[0] is not None else 0
            views_dict[ticker] = mu[ticker] + (score * 0.10)
        conn.close()

        bl = BlackLittermanModel(S, pi=mu, absolute_views=views_dict)
        mu_bl = bl.bl_returns()

        current_w_array = np.array([normalized_current.get(t, 0) for t in valid_tickers])
        mu_bl_aligned = np.array([mu_bl[t] for t in valid_tickers])
        S_aligned = S.loc[valid_tickers, valid_tickers].values
        
        current_ret = np.dot(current_w_array, mu_bl_aligned)
        current_vol = np.sqrt(np.dot(current_w_array.T, np.dot(S_aligned, current_w_array)))
        current_sharpe = (current_ret - 0.02) / current_vol if current_vol > 0 else 0

        max_weight = 0.30 if len(valid_tickers) >= 4 else 1.0
        ef = EfficientFrontier(mu_bl, S, weight_bounds=(0.0, max_weight))
        ef.max_sharpe() 
        expected_return, volatility, sharpe_ratio = ef.portfolio_performance()
        target_weights = ef.clean_weights(cutoff=0.01)
        
        rebalance_orders = []
        for ticker in valid_tickers:
            actual_w = normalized_current.get(ticker, 0)
            target_w = target_weights.get(ticker, 0)
            delta = target_w - actual_w
            
            if abs(delta) > 0.01:
                rebalance_orders.append({
                    "asset": ticker,
                    "action": "COMPRAR" if delta > 0 else "VENDER",
                    "delta_pct": round(abs(delta) * 100, 2),
                    "target_pct": round(target_w * 100, 2)
                })

        return {
            "current_weights": {k: round(v * 100, 2) for k, v in normalized_current.items()},
            "optimal_weights": {k: round(v * 100, 2) for k, v in target_weights.items()},
            "rebalance_orders": sorted(rebalance_orders, key=lambda x: x['action'], reverse=True),
            "current_performance_metrics": {
                "expected_annual_return_pct": round(current_ret * 100, 2),
                "annual_volatility_pct": round(current_vol * 100, 2),
                "sharpe_ratio": round(current_sharpe, 2)
            },
            "performance_metrics": {
                "expected_annual_return_pct": round(expected_return * 100, 2),
                "annual_volatility_pct": round(volatility * 100, 2),
                "sharpe_ratio": round(sharpe_ratio, 2)
            }
        }
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

# ================= 2. SCREENER INSTITUCIONAL =================
@app.get("/api/v1/screener")
def market_screener():
    if not os.path.exists("market_data.json"):
        return {"top_picks": [], "error": "Data Lake no encontrado. Ejecuta actualizador.py primero."}
        
    with open("market_data.json", "r") as f:
        market_data = json.load(f)
        
    results = []
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    for ticker, data in market_data.items():
        cursor.execute('SELECT AVG(sentiment_score) FROM sentiment_history WHERE ticker = ?', (ticker,))
        row = cursor.fetchone()
        ai_score = row[0] if row[0] is not None else 0
        
        roe = data.get("roe") or 0
        revenue_growth = data.get("revenue_growth_yoy") or 0
        
        if ai_score > 0.15 and (roe > 0.15 or revenue_growth > 0.15):
            rec = "COMPRA FUERTE"
        elif roe > 0.10 or revenue_growth > 0.10 or ai_score > 0.1:
            rec = "COMPRAR"
        else:
            rec = "MANTENER"
            
        data["ticker"] = ticker
        data["ai_score"] = round(ai_score, 2)
        data["recommendation"] = rec
        results.append(data)

    conn.close()
    
    # Ordenamos combinando IA, Rentabilidad y Crecimiento
    results = sorted(results, key=lambda x: (x.get('ai_score', 0) + (x.get('roe') or 0)), reverse=True)
    # Mostramos el Top 24 en lugar del Top 15
    return {"top_picks": results[:24]}

# ================= 3. CARTERA MODELO (NUEVO DINERO) =================
@app.get("/api/v1/model_portfolio")
def get_model_portfolio():
    try:
        if not os.path.exists("market_data.json"):
            raise HTTPException(status_code=404, detail="Data Lake no encontrado.")
            
        with open("market_data.json", "r") as f:
            market_data = json.load(f)
            
        # Seleccionamos las 10 mejores acciones cruzando IA + ROE
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()
        valid_stocks = []
        for t, data in market_data.items():
            cursor.execute('SELECT AVG(sentiment_score) FROM sentiment_history WHERE ticker = ?', (t,))
            row = cursor.fetchone()
            score = row[0] if row[0] is not None else 0
            roe = data.get("roe") or 0
            if roe > 0.05: # Filtro mínimo de calidad
                valid_stocks.append((t, score + roe))
        conn.close()
        
        valid_stocks.sort(key=lambda x: x[1], reverse=True)
        top_tickers = [x[0] for x in valid_stocks[:10]]
        
        # Pool de empresas de élite por si el Data Lake es muy pequeño
        if len(top_tickers) < 5:
            top_tickers = ["AAPL", "MSFT", "NVDA", "V", "JNJ", "WMT", "JPM", "PG"]
            
        tickers_tuple = tuple(sorted(top_tickers + ["SPY"]))
        df_all = fetch_historical_data(tickers_tuple, period="5y")
        
        df_all.dropna(axis=1, how='all', inplace=True)
        df_all.ffill(inplace=True)
        df_all.dropna(inplace=True)
        
        valid_t = [t for t in top_tickers if t in df_all.columns]
        df_universe = df_all[valid_t]
        
        mu = mean_historical_return(df_universe)
        S = CovarianceShrinkage(df_universe).ledoit_wolf()
        
        # Optimizamos limitando cada activo al 25% para forzar diversificación real
        ef = EfficientFrontier(mu, S, weight_bounds=(0.05, 0.25))
        ef.max_sharpe()
        ret, vol, sharpe = ef.portfolio_performance()
        weights = ef.clean_weights(cutoff=0.01)
        
        # Benchmark contra el mercado (SPY)
        spy_returns = df_all['SPY'].pct_change().dropna()
        spy_ret = spy_returns.mean() * 252
        spy_vol = spy_returns.std() * np.sqrt(252)
        spy_sharpe = (spy_ret - 0.02) / spy_vol if spy_vol > 0 else 0
        
        return {
            "assets": [{"ticker": k, "weight": round(v * 100, 2)} for k, v in weights.items() if v > 0],
            "metrics": {
                "return_pct": round(ret * 100, 2),
                "volatility_pct": round(vol * 100, 2),
                "sharpe": round(sharpe, 2)
            },
            "benchmark": {
                "return_pct": round(spy_ret * 100, 2),
                "volatility_pct": round(spy_vol * 100, 2),
                "sharpe": round(spy_sharpe, 2)
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))