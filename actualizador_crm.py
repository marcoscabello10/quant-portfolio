import os
import yfinance as yf
from datetime import datetime
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()
supabase: Client = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY"))

def main():
    print("Iniciando escáner de precios subyacentes...")
    hoy = datetime.now().strftime("%Y-%m-%d")

    # 1. Obtener lista de tickers únicos activos de la base de datos
    try:
        res = supabase.table("tenencias").select("ticker_origen").gt("nominales", 0).neq("ticker", "OTRO").execute()
        tickers_activos = list(set([item['ticker_origen'] for item in res.data if item['ticker_origen']]))
    except Exception as e:
        print(f"Error obteniendo tickers: {e}")
        return

    print(f"Se encontraron {len(tickers_activos)} activos internacionales para seguir.")
    
    # 2. Consultar Yahoo Finance
    errores = []
    exitos = 0
    for ticker in tickers_activos:
        try:
            # yfinance descarga el precio más reciente
            data = yf.Ticker(ticker).history(period="1d")
            if not data.empty:
                precio_cierre = float(data['Close'].iloc[-1])
                
                # 3. Guardar en Supabase (Upsert)
                registro = {"ticker_origen": ticker, "fecha": hoy, "precio_cierre": round(precio_cierre, 4)}
                supabase.table("precios_subyacente").upsert(registro).execute()
                exitos += 1
                print(f"✔️ {ticker}: ${precio_cierre:.2f}")
            else:
                errores.append(ticker)
        except Exception:
            errores.append(ticker)

    print(f"\n📊 Resumen: {exitos} precios actualizados.")
    if errores:
        print(f"⚠️ No se encontró data en Yahoo para: {', '.join(errores)}")

if __name__ == "__main__":
    main()