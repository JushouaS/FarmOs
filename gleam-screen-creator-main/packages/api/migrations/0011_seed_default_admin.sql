-- 0011_seed_default_admin.sql
-- Creates a default ADMIN user for development/testing.
-- Password: CereBroiler@2024!

INSERT INTO users (id, email, password_hash, full_name, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'admin@cerebroiler.dev',
    '$2b$12$L1eLk3OsbT6oNp7qwaH3pOhV3NoIYVCXyZ6w6LoDCOJhncTLkObAO',
    'System Administrator',
    true
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '00000000-0000-0000-0000-000000000001', r.id
FROM roles r
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;
