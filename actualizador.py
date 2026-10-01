import yfinance as yf
import json
import os
import time
from datetime import datetime

def get_universe_from_file():
    if not os.path.exists("cedears.txt"):
        return ["AAPL", "MSFT", "NVDA", "KO", "JPM", "XOM"]
    with open("cedears.txt", "r") as file:
        return [line.strip().upper() for line in file if line.strip()]

def build_data_lake():
    tickers = get_universe_from_file()
    total = len(tickers)
    market_data = {}
    
    print(f"Iniciando descarga masiva de {total} activos...")
    
    for i, t in enumerate(tickers, 1):
        print(f"[{i}/{total}] Extrayendo {t}...", end="", flush=True)
        try:
            stock = yf.Ticker(t)
            info = stock.info
            
            # Si no hay sector, la empresa está deslistada o el ticker es inválido
            if "sector" not in info:
                print(" ❌ Sin datos.")
                continue
                
            # Extraemos la matriz de datos completa
            market_data[t] = {
                "sector": info.get("sector", "Desconocido"),
                "industry": info.get("industry", "Desconocida"),
                
                # Valoración
                "pe_ratio": info.get("trailingPE"),
                "forward_pe": info.get("forwardPE"),
                "peg_ratio": info.get("pegRatio"),
                "price_to_book": info.get("priceToBook"),
                "ev_ebitda": info.get("enterpriseToEbitda"),
                
                # Rentabilidad
                "roe": info.get("returnOnEquity"),
                "roa": info.get("returnOnAssets"),
                "operating_margin": info.get("operatingMargins"),
                "dividend_yield": info.get("dividendYield"),
                
                # Crecimiento (Growth)
                "revenue_growth_yoy": info.get("revenueGrowth"),
                "earnings_growth_yoy": info.get("earningsGrowth"),
                
                # Riesgo / Salud Financiera
                "debt_to_equity": info.get("debtToEquity"),
                "current_ratio": info.get("currentRatio"),
                "beta": info.get("beta"),
                
                "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            print(" ✅ OK.")
            
            # Pausa de 1.5 segundos para no saturar a Yahoo Finance
            time.sleep(1.5)
            
        except Exception as e:
            print(f" ❌ Error.")
            continue

    # Guardamos el archivo maestro
    with open("market_data.json", "w") as f:
        json.dump(market_data, f, indent=4)
        
    print(f"\n¡Data Lake actualizado! Archivo 'market_data.json' generado exitosamente.")

if __name__ == "__main__":
    build_data_lake()