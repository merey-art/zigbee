"""
Seed demo sensor data for ~90% of offices across all 4 floors.
Does NOT touch existing companies/devices (Ритмус! etc.).
Run from the project root:
  python seed_demo.py
"""

import random
import math
from datetime import datetime, timezone, timedelta

import psycopg2
import psycopg2.extras

DB_DSN = "host=localhost port=15432 dbname=zigbee user=zigbee password=zigbeepass"

# All offices mirroring floors.ts
FLOORS = {
    1: [f"f1-{i}" for i in range(1, 18)],   # 17 offices
    2: [f"f2-{i}" for i in range(1, 18)],   # 17 offices
    3: [f"f3-{i}" for i in range(1, 17)],   # 16 offices
    4: [f"f4-{i}" for i in range(1, 23)],   # 22 offices
}

OFFICE_NAMES = {
    1: [f"Office 1.{i}" for i in range(1, 18)],
    2: [f"Office 2.{i}" for i in range(1, 18)],
    3: [f"Office 3.{i}" for i in range(1, 17)],
    4: [f"Office 4.{i}" for i in range(1, 23)],
}

# Realistic tenant names for offices
TENANT_NAMES = [
    "Altera Group", "BioTech KZ", "CaspianSoft", "DataFlow", "EcoSpace",
    "FintechHub", "GlobalPay", "Horizons", "InnovateLab", "JetStream",
    "Kinesis", "LegalPro", "MetroDesign", "NexGen", "Orbis",
    "PrimeCode", "Quantus", "Redline", "SkyBridge", "TrustNet",
    "UrbanPlan", "VisionTech", "WebCore", "XactData", "YieldAI",
    "Zenith", "Apex Solutions", "BluePrint", "CoreLogic", "DevStack",
    "EasyPay", "FluxLab", "GreenByte", "HelixCorp", "IdeaForge",
    "JetCode", "KazLogistic", "LunarSoft", "MindBridge", "NetPulse",
    "OpenSpace", "ProTrade", "QbitSys", "RealtyDev", "SmartHub",
    "TechBase", "UniCloud", "VectorX", "WaveNet", "XcelGroup",
    "YourSpace", "ZoneIT", "ArcticAI", "BeaconSys", "CityCloud",
    "DeltaForce", "EmeraldTech", "FusionLab", "GalaxyPro", "HorizonX",
    "ImpactHub", "JuniperIT", "KineticsKZ",
]

random.seed(42)


def gen_co2_series(now: datetime, hours: int = 24) -> list[tuple[datetime, float, float, float]]:
    """Generate (timestamp, co2, temperature, humidity) for the past `hours` hours."""
    result = []
    n_points = hours * 6  # every 10 minutes

    # Base values with daily cycle
    base_co2 = random.uniform(420, 650)
    base_temp = random.uniform(19.5, 25.0)
    base_hum = random.uniform(38, 58)

    # Some offices have elevated CO2 (simulates poor ventilation)
    elevated = random.random() < 0.25
    if elevated:
        base_co2 = random.uniform(750, 1100)

    for i in range(n_points):
        t = now - timedelta(minutes=10 * (n_points - i))
        hour = t.hour

        # Daytime occupancy effect (8am–7pm)
        occupancy = max(0.0, math.sin(math.pi * (hour - 8) / 11)) if 8 <= hour <= 19 else 0.0
        co2 = base_co2 + occupancy * random.uniform(200, 450) + random.gauss(0, 15)
        co2 = max(380, co2)

        temp = base_temp + occupancy * random.uniform(0.5, 2.0) + random.gauss(0, 0.3)
        hum = base_hum - occupancy * random.uniform(2, 8) + random.gauss(0, 1.5)
        hum = max(25, min(80, hum))

        result.append((t, round(co2), round(temp, 1), round(hum, 1)))
    return result


def gen_temp_series(now: datetime, hours: int = 24) -> list[tuple[datetime, float, float]]:
    """Generate (timestamp, temperature, humidity) for a temp-only device."""
    result = []
    n_points = hours * 6

    base_temp = random.uniform(20.0, 24.5)
    base_hum = random.uniform(40, 60)

    for i in range(n_points):
        t = now - timedelta(minutes=10 * (n_points - i))
        hour = t.hour
        occupancy = max(0.0, math.sin(math.pi * (hour - 8) / 11)) if 8 <= hour <= 19 else 0.0
        temp = base_temp + occupancy * random.uniform(0.5, 1.8) + random.gauss(0, 0.2)
        hum = base_hum - occupancy * random.uniform(1, 5) + random.gauss(0, 1.0)
        hum = max(25, min(80, hum))
        result.append((t, round(temp, 1), round(hum, 1)))
    return result


def main():
    conn = psycopg2.connect(DB_DSN)
    conn.autocommit = False
    cur = conn.cursor()

    # ── Find already-used office_ids ──────────────────────────────────────────
    cur.execute("SELECT office_id FROM companies WHERE office_id IS NOT NULL")
    used_offices = {row[0] for row in cur.fetchall()}
    print(f"Already used offices: {used_offices}")

    # ── Build list of all offices (floor_id, office_id, name) ────────────────
    all_offices = []
    for floor_id, office_ids in FLOORS.items():
        names = OFFICE_NAMES[floor_id]
        for oid, name in zip(office_ids, names):
            if oid not in used_offices:
                all_offices.append((floor_id, oid, name))

    total_offices = sum(len(v) for v in FLOORS.values())  # 72
    already_count = len(used_offices)
    target_filled = round(total_offices * 0.90)
    need_new = target_filled - already_count
    print(f"Total offices: {total_offices}, already filled: {already_count}, target: {target_filled}, adding: {need_new}")

    # Pick which offices to fill (deterministic via seed)
    to_fill = random.sample(all_offices, min(need_new, len(all_offices)))

    # Assign tenant names
    tenant_pool = random.sample(TENANT_NAMES, len(to_fill))

    now = datetime.now(timezone.utc)

    readings_batch = []
    device_company_batch = []

    for (floor_id, office_id, _office_name), tenant_name in zip(to_fill, tenant_pool):
        # Create company
        cur.execute(
            """
            INSERT INTO companies (name, floor_id, office_id,
                                   co2_device_id, temp_device_id, created_at)
            VALUES (%s, %s, %s, %s, %s, NOW())
            ON CONFLICT (name) DO NOTHING
            RETURNING id
            """,
            (
                tenant_name,
                floor_id,
                office_id,
                f"demo-co2-{office_id}",
                f"demo-thsensor-{office_id}",
            ),
        )
        row = cur.fetchone()
        if row is None:
            # Name conflict — append suffix
            tenant_name_alt = f"{tenant_name} ({office_id})"
            cur.execute(
                """
                INSERT INTO companies (name, floor_id, office_id,
                                       co2_device_id, temp_device_id, created_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                RETURNING id
                """,
                (
                    tenant_name_alt,
                    floor_id,
                    office_id,
                    f"demo-co2-{office_id}",
                    f"demo-thsensor-{office_id}",
                ),
            )
            row = cur.fetchone()
        company_id = row[0]

        co2_dev = f"demo-co2-{office_id}"
        temp_dev = f"demo-thsensor-{office_id}"

        # Link devices → company
        device_company_batch.append((co2_dev.lower(), company_id))
        device_company_batch.append((temp_dev.lower(), company_id))

        # Generate CO2 device readings (co2 + temperature + humidity)
        for ts, co2, temp, hum in gen_co2_series(now):
            readings_batch.append((co2_dev, "co2", co2, ts))
            readings_batch.append((co2_dev, "temperature", temp, ts))
            readings_batch.append((co2_dev, "humidity", hum, ts))

        # Generate temp/humidity-only sensor
        for ts, temp, hum in gen_temp_series(now):
            readings_batch.append((temp_dev, "temperature", temp, ts))
            readings_batch.append((temp_dev, "humidity", hum, ts))

    print(f"Inserting {len(readings_batch)} readings for {len(to_fill)} offices…")

    # Bulk insert device_companies
    psycopg2.extras.execute_values(
        cur,
        """
        INSERT INTO device_companies (device_ieee, company_id)
        VALUES %s
        ON CONFLICT (device_ieee) DO NOTHING
        """,
        device_company_batch,
    )

    # Bulk insert sensor_readings in chunks of 5000
    chunk_size = 5000
    for start in range(0, len(readings_batch), chunk_size):
        chunk = readings_batch[start:start + chunk_size]
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO sensor_readings (device_id, metric, value, recorded_at)
            VALUES %s
            """,
            chunk,
        )
        print(f"  inserted chunk {start}–{start + len(chunk)}")

    conn.commit()
    cur.close()
    conn.close()
    print("Done! Demo data seeded successfully.")


if __name__ == "__main__":
    main()
