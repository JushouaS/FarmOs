-- Register the camera the vision service actually streams.
--
-- cerebroil-stream (the Flask vision service) calls the overhead Dahua camera
-- "CAM-01", and the web app asks for scans of "CAM-01". The seed only knew the
-- cameras UNIT_02_NORTH and UNIT_04_NORTH, so POST /visual/analyze and
-- POST /visual/scan looked CAM-01 up in `cameras`, found nothing, and quietly
-- dropped every result (the response said db_written: false).
--
-- CAM-01 watches House 02, the house the dashboard already reports on. Mount
-- position, frame rate and resolution are not known to the database, so they
-- stay NULL rather than being guessed.
INSERT INTO cameras (id, house_id, online)
VALUES ('CAM-01', 'H02', true)
ON CONFLICT (id) DO NOTHING;
