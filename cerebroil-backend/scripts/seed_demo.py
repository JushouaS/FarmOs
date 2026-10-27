"""
scripts/seed_demo.py
─────────────────────
Inserts a demo farm → house → batch via raw SQL so the batchstatus ENUM
cast is done entirely by PostgreSQL — bypassing any ORM type-binding issues.
"""
from __future__ import annotations

import asyncio
import sys

sys.path.insert(0, ".")

from sqlalchemy import text
from app.database import AsyncSessionLocal


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        # Check for existing data
        existing = (await db.execute(
            text("SELECT id FROM farms WHERE name = 'Demo Farm' LIMIT 1")
        )).scalar_one_or_none()

        if existing:
            print("Demo data already seeded — fetching existing batch_id …")
            batch_id = (await db.execute(
                text(
                    "SELECT b.id FROM batches b "
                    "JOIN houses h ON b.house_id = h.id "
                    "JOIN farms f  ON h.farm_id  = f.id "
                    "WHERE f.name = 'Demo Farm' "
                    "ORDER BY b.created_at DESC LIMIT 1"
                )
            )).scalar_one_or_none()
            print(f"\n  batch_id = {batch_id}\n")
            return

        # Insert via raw SQL so PostgreSQL casts values to the ENUM types itself
        farm_id = (await db.execute(
            text(
                "INSERT INTO farms (name, location) "
                "VALUES ('Demo Farm', 'Agora de Oro City') "
                "RETURNING id"
            )
        )).scalar_one()

        house_id = (await db.execute(
            text(
                "INSERT INTO houses (farm_id, house_name, camera_ip) "
                "VALUES (:fid, 'Pen 1', '192.168.1.50') "
                "RETURNING id"
            ),
            {"fid": farm_id},
        )).scalar_one()

        batch_id = (await db.execute(
            text(
                "INSERT INTO batches "
                "(house_id, initial_bird_count, start_date, "
                " target_harvest_date, status) "
                "VALUES (:hid, 28, "
                "  CURRENT_DATE - INTERVAL '14 days', "
                "  CURRENT_DATE + INTERVAL '28 days', "
                "  'active'::batchstatus) "
                "RETURNING id"
            ),
            {"hid": house_id},
        )).scalar_one()

        await db.commit()

        print("\n✅  Demo data seeded successfully!")
        print(f"   farm_id  = {farm_id}")
        print(f"   house_id = {house_id}")
        print(f"   batch_id = {batch_id}")
        print(f"\n  Use this batch_id in POST /api/v1/telemetry/events\n")


if __name__ == "__main__":
    asyncio.run(seed())
