import os
import math
import pandas as pd
from supabase import create_client, Client
from dotenv import load_dotenv, find_dotenv

# 1. Configuración inicial con radar de archivo .env
env_path = find_dotenv()
load_dotenv(env_path)

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")

if not url or not key:
    raise ValueError("¡ALERTA! Sigo sin encontrar las claves. Verifica que el archivo se llame exactamente .env.")

supabase: Client = create_client(url, key)

def limpiar_datos(df):
    """Limpia los NaN y corrige el error de Pandas con los enteros terminados en .0"""
    # 1. Reemplaza los vacíos (NaN) de Pandas por valores nulos reales (None)
    df = df.where(pd.notnull(df), None)
    records = df.to_dict(orient='records')
    
    # 2. Recorre cada dato. Si es un float como 48.0, lo transforma al entero 48
    for row in records:
        for k, v in row.items():
            if isinstance(v, float):
                if math.isnan(v):
                    row[k] = None
                elif v.is_integer():
                    row[k] = int(v)
    return records

def cargar_lotes(tabla, records, batch_size=500, on_conflict=None):
    total = len(records)
    cargados = 0
    for i in range(0, total, batch_size):
        lote = records[i:i+batch_size]
        try:
            if on_conflict:
                res = supabase.table(tabla).upsert(lote, on_conflict=on_conflict).execute()
            else:
                res = supabase.table(tabla).upsert(lote).execute()
            
            # Supabase devuelve los datos insertados, los contamos
            if res.data:
                cargados += len(res.data)
        except Exception as e:
            print(f"Error cargando lote en {tabla}: {e}")
    return cargados

def main():
    print("Iniciando migración masiva a Supabase...")

    # 1. Cargar Ratios
    print("\nLeyendo ratios_cedear.csv...")
    df_ratios = pd.read_csv("ratios_cedear.csv")
    ratios = limpiar_datos(df_ratios)
    c_ratios = cargar_lotes("ratios_cedear", ratios)
    print(f"✅ Ratios cargados: {c_ratios}/{len(ratios)}")

    # 2. Cargar Clientes
    print("\nLeyendo clientes.csv...")
    df_clientes = pd.read_csv("clientes.csv", dtype={'telefono': str, 'comitente': int})
    clientes = limpiar_datos(df_clientes)
    c_clientes = cargar_lotes("clientes", clientes)
    print(f"✅ Clientes cargados: {c_clientes}/{len(clientes)}")

    # 3. Cargar Tenencias
    print("\nLeyendo tenencias.csv...")
    df_tenencias = pd.read_csv("tenencias.csv", dtype={'comitente': int})
    tenencias = limpiar_datos(df_tenencias)
    c_tenencias = cargar_lotes("tenencias", tenencias, on_conflict="comitente,ticker,fecha_corte")
    print(f"✅ Tenencias cargadas: {c_tenencias}/{len(tenencias)}")
    
    print("\n🚀 ¡Migración completada con éxito!")

if __name__ == "__main__":
    main()