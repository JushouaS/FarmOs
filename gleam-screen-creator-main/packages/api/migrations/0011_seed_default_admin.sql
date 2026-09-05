-- 0011_seed_default_admin.sql
-- Creates a placeholder ADMIN user for development/testing.
--
-- IMPORTANT: The password hash below is intentionally left empty.
-- Run the seed script to generate a real admin account:
--
--   npx tsx packages/api/scripts/seed-admin.ts
--
-- That script generates a random password, prints it once to stdout,
-- and stores only the bcrypt hash. Never commit real passwords to source control.

-- This migration is intentionally a no-op insert so the schema is consistent.
-- The actual admin account must be created via the seed script.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@cerebroiler.dev') THEN
    RAISE NOTICE 'No default admin seeded. Run: npx tsx packages/api/scripts/seed-admin.ts';
  END IF;
END $$;
