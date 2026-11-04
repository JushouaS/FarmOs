-- 0024_dht22_sensors.sql
-- The pen's real temperature and humidity sensor: a DHT22 on the Raspberry Pi. The API reads it from
-- the camera service every minute (sensor-monitor.ts) and stores each reading here, in the same
-- tables the sample sensors use, so the dashboard shows the real numbers with no other change.
-- The pen is house H02 ("Pen 1"). The bounds are a starting point for a broiler house; change them
-- by adding a row with a later effective_from.

INSERT INTO sensors (id, house_id, sensor_type_code, code, label, serial, installed_at) VALUES
    ('SN-DHT22-T', 'H02', 'temperature', 'TEMP_H02',  'TEMP',  'DHT22', now()),
    ('SN-DHT22-H', 'H02', 'humidity',    'HUMID_H02', 'HUMID', 'DHT22', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO sensor_bounds (sensor_id, lower_bound, upper_bound, display_label, effective_from) VALUES
    ('SN-DHT22-T', 20, 32, '20-32 °C', '2024-01-01'),
    ('SN-DHT22-H', 50, 70, '50-70%',   '2024-01-01')
ON CONFLICT (sensor_id, effective_from) DO NOTHING;
