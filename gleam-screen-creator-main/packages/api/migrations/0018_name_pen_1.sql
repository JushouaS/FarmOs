-- 0018_name_pen_1.sql
-- The farm has one pen, and everywhere else in the app (Flock Tracking, Live
-- Camera) calls it "Pen 1". The house the camera watches was seeded as
-- "House 02"; give it the name the farm uses. Only renames it if it still has
-- the seeded name, so a name someone set by hand is left alone.

UPDATE houses
SET label = 'Pen 1', updated_at = now()
WHERE id = 'H02' AND label = 'House 02';
