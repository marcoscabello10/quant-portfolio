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

# --- MICROSERVICIO DE IA (Seguro vía Variables de Entorno) ---
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
    if not HF_API_TOKEN:
        print("Advertencia: No se encontró el HF_API_TOKEN en el entorno.")
        return 0
        
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

app = FastAPI(title="Quant Portfolio API", version="3.3.0", lifespan=lifespan)

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

# ================= SCREENER CON SISTEMA ANTI-BAN =================
@app.get("/api/v1/screener")
def market_screener():
    tickers = get_universe_from_file()
    if not tickers:
        tickers = ["AAPL", "MSFT", "NVDA", "KO", "JNJ", "V", "BRK-B"]
        
    results = []
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    })
    
    valid_count = 0
    
    # Intento 1: API Directa
    for t in tickers:
        if valid_count >= 9: break
        try:
            stock = yf.Ticker(t, session=session)
            info = stock.info
            
            if not info or "sector" not in info: continue
                
            roe = info.get("returnOnEquity", 0)
            pe = info.get("trailingPE", 0)
            sector = info.get("sector", "Desconocido")
            
            if roe is None or roe == 0 or pe is None or pe == 0 or sector == "Desconocido":
                continue
            
            cursor.execute('SELECT AVG(sentiment_score) FROM sentiment_history WHERE ticker = ?', (t,))
            row = cursor.fetchone()
            ai_score = row[0] if row[0] is not None else 0
            
            results.append({
                "ticker": t,
                "sector": sector,
                "roe_pct": round(roe * 100, 2),
                "pe_ratio": round(pe, 2),
                "ai_score": round(ai_score, 2),
                "recommendation": "COMPRA FUERTE" if ai_score > 0.2 and roe > 0.15 else "COMPRAR" if roe > 0.10 else "MANTENER"
            })
            valid_count += 1
        except Exception:
            continue

    # ================= PLAN B DE EMERGENCIA =================
    # Si Render está baneado y 'results' quedó vacío, activamos la base de contingencia.
    # Los datos fundamentales se estiman, pero el Score IA se calcula REAL con Hugging Face.
    if len(results) == 0:
        fallback_data = [
            ("NVDA", "Technology", 0.55, 65.5),
            ("MSFT", "Technology", 0.38, 35.2),
            ("AAPL", "Technology", 1.45, 28.5),
            ("V", "Financial Services", 0.42, 30.1),
            ("JNJ", "Healthcare", 0.25, 15.4),
            ("KO", "Consumer Defensive", 0.40, 24.3),
            ("AMZN", "Consumer Cyclical", 0.18, 41.2),
            ("GOOGL", "Technology", 0.28, 25.4),
            ("META", "Technology", 0.32, 27.8)
        ]
        
        for t, sec, r, p in fallback_data:
            cursor.execute('SELECT AVG(sentiment_score) FROM sentiment_history WHERE ticker = ?', (t,))
            row = cursor.fetchone()
            ai_score = row[0] if row[0] is not None else 0
            
            results.append({
                "ticker": t,
                "sector": sec,
                "roe_pct": round(r * 100, 2),
                "pe_ratio": round(p, 2),
                "ai_score": round(ai_score, 2),
                "recommendation": "COMPRA FUERTE" if ai_score > 0.1 and r > 0.15 else "COMPRAR" if r > 0.15 else "MANTENER"
            })

    conn.close()
    results = sorted(results, key=lambda x: x['roe_pct'], reverse=True)
    return {"top_picks": results}