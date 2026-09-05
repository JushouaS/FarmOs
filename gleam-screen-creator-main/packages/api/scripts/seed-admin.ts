/**
 * seed-admin.ts
 *
 * Generates a secure random password, hashes it with bcrypt, inserts (or
 * updates) the default admin user, and prints the raw password ONCE to stdout.
 *
 * Usage:
 *   npx tsx packages/api/scripts/seed-admin.ts
 *
 * The raw password is never written to disk or committed to version control.
 * Store it in a password manager immediately after running this script.
 */

import { randomBytes } from "node:crypto";
import { hash } from "bcrypt";
import postgres from "postgres";
import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __here = fileURLToPath(new URL(".", import.meta.url));
dotenv.config({ path: resolve(__here, "..", ".env") });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Error: DATABASE_URL is not set. Check packages/api/.env");
  process.exit(1);
}

// Generate a strong random password: 20 chars, base64url-safe
const rawPassword = randomBytes(15).toString("base64url");
const passwordHash = await hash(rawPassword, 12);

const sql = postgres(DATABASE_URL, { max: 1 });

try {
  await sql`
    INSERT INTO users (id, email, password_hash, full_name, is_active)
    VALUES (
      gen_random_uuid(),
      'admin@cerebroiler.dev',
      ${passwordHash},
      'System Administrator',
      true
    )
    ON CONFLICT (email)
    DO UPDATE SET password_hash = ${passwordHash}, updated_at = now()
  `;

  await sql`
    INSERT INTO user_roles (user_id, role_id)
    SELECT u.id, r.id
    FROM users u, roles r
    WHERE u.email = 'admin@cerebroiler.dev'
      AND r.code = 'ADMIN'
    ON CONFLICT DO NOTHING
  `;

  console.log("\n✅ Admin account ready");
  console.log("   Email:    admin@cerebroiler.dev");
  console.log(`   Password: ${rawPassword}`);
  console.log("\n⚠️  Save this password now — it will NOT be shown again.\n");
} finally {
  await sql.end();
}
