-- Pen 1 (H02) currently has 28 broilers. Keep the flock-tracking count in
-- sync for existing installations as well as fresh databases.
UPDATE houses
SET population = 28, updated_at = now()
WHERE id = 'H02';
