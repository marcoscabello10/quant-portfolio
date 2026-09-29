@app.get("/api/v1/screener")
def market_screener():
    # Buscamos nuestro universo de CEDEARs
    tickers = get_universe_from_file()
    if not tickers:
        tickers = ["AAPL", "MSFT", "NVDA", "KO", "JNJ", "V", "BRK-B"]
        
    results = []
    
    # Nos conectamos a la base de datos para buscar el sentimiento de la IA
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Escaneamos los primeros 15 para no saturar el servidor gratuito
    for t in tickers[:15]:
        try:
            # 1. Extraemos Fundamentals en tiempo real
            stock = yf.Ticker(t)
            info = stock.info
            roe = info.get("returnOnEquity", 0)
            pe = info.get("trailingPE", 0)
            sector = info.get("sector", "Desconocido")
            
            # 2. Extraemos el Sentimiento de la IA
            cursor.execute('SELECT AVG(sentiment_score) FROM sentiment_history WHERE ticker = ?', (t,))
            row = cursor.fetchone()
            ai_score = row[0] if row[0] is not None else 0
            
            # Solo guardamos empresas con datos válidos
            if roe is not None and pe is not None:
                results.append({
                    "ticker": t,
                    "sector": sector,
                    "roe_pct": round(roe * 100, 2),
                    "pe_ratio": round(pe, 2),
                    "ai_score": round(ai_score, 2),
                    # Lógica de recomendación del motor
                    "recommendation": "COMPRA FUERTE" if ai_score > 0.3 and roe > 0.15 else "COMPRAR" if roe > 0.15 else "MANTENER"
                })
        except Exception:
            continue
            
    conn.close()
    
    # El Screener devuelve la lista ordenada desde el mejor ROE al peor
    results = sorted(results, key=lambda x: x['roe_pct'], reverse=True)
    return {"top_picks": results}