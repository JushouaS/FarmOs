-- 0009_seed_from_dataset.sql
-- Seeds the database with the exact values from the frontend seed dataset
-- (src/lib/farm/dataset.ts) so the existing UI produces identical output when
-- its repository handlers are later pointed at the API.

-- Sensor parameter catalogue.
INSERT INTO sensor_types (code, label, unit, display_format) VALUES
    ('temperature', 'Temperature',       '°C',  '{decimals:1}'),
    ('humidity',    'Relative humidity', '%',   '{decimals:0}'),
    ('co2',         'Carbon dioxide',    'PPM', '{decimals:0,thousands:true}'),
    ('nh3',         'Ammonia',           'PPM', '{decimals:0}'),
    ('light',       'Light',             'LX',  '{decimals:0}'),
    ('airflow',     'Airflow',           'M/S', '{decimals:1}')
ON CONFLICT (code) DO NOTHING;

-- Facility + houses.
INSERT INTO facilities (id, name, breed, house_range_label, timezone) VALUES
    ('FARM-001', 'POULTRY_AI', 'Ross 308', 'Houses 01-04', 'UTC')
ON CONFLICT (id) DO UPDATE SET
    name              = EXCLUDED.name,
    breed             = EXCLUDED.breed,
    house_range_label = EXCLUDED.house_range_label;

INSERT INTO houses (id, facility_id, label, section, population, sort_order) VALUES
    ('H01', 'FARM-001', 'House 01', 'SEC_A', 4210, 1),
    ('H02', 'FARM-001', 'House 02', 'SEC_B', 4180, 2),
    ('H03', 'FARM-001', 'House 03', 'SEC_C', 4260, 3),
    ('H04', 'FARM-001', 'House 04', 'SEC_D', 4190, 4)
ON CONFLICT (id) DO UPDATE SET
    label      = EXCLUDED.label,
    section    = EXCLUDED.section,
    population = EXCLUDED.population;

-- Active flock cycle.
INSERT INTO flock_cycles (id, facility_id, label, breed, start_date, projected_yield_date, status)
VALUES ('FC-2024-07', 'FARM-001', 'FLOCK_01', 'Ross 308', '2024-04-12', '2024-05-27', 'active')
ON CONFLICT (id) DO UPDATE SET
    label                = EXCLUDED.label,
    start_date           = EXCLUDED.start_date,
    projected_yield_date = EXCLUDED.projected_yield_date;

-- Growth curve (cycle_weights) and cohorts.
INSERT INTO cycle_weights (cycle_id, day, actual_g, standard_g, sample_size, estimation_confidence, recorded_at) VALUES
    ('FC-2024-07', 1,  62,   60,   NULL, NULL, '2024-04-13T00:00:00Z'),
    ('FC-2024-07', 7,  196,  190,  NULL, NULL, '2024-04-19T00:00:00Z'),
    ('FC-2024-07', 14, 472,  460,  NULL, NULL, '2024-04-26T00:00:00Z'),
    ('FC-2024-07', 21, 918,  900,  NULL, NULL, '2024-05-03T00:00:00Z'),
    ('FC-2024-07', 28, 1428, 1400, NULL, NULL, '2024-05-10T00:00:00Z'),
    ('FC-2024-07', 35, 1988, 1950, NULL, NULL, '2024-05-17T00:00:00Z'),
    ('FC-2024-07', 42, 2452, 2422, 4820, 0.94, '2024-05-24T21:10:00Z')
ON CONFLICT (cycle_id, day) DO UPDATE SET
    actual_g              = EXCLUDED.actual_g,
    standard_g            = EXCLUDED.standard_g,
    sample_size           = EXCLUDED.sample_size,
    estimation_confidence = EXCLUDED.estimation_confidence;

INSERT INTO cohorts (id, cycle_id, house_id, min_g, max_g, standard_deviation_g, median_g, status) VALUES
    ('SEC_A_FLOCK_01', 'FC-2024-07', 'H01', 2104, 2855, 112, 2480, 'nominal'),
    ('SEC_B_FLOCK_01', 'FC-2024-07', 'H02', 1980, 2740, 145, 2390, 'deviation'),
    ('SEC_C_FLOCK_01', 'FC-2024-07', 'H03', 2150, 2910, 98,  2510, 'nominal'),
    ('SEC_D_FLOCK_01', 'FC-2024-07', 'H04', 2050, 2690, 130, 2428, 'nominal')
ON CONFLICT (id) DO UPDATE SET
    min_g                = EXCLUDED.min_g,
    max_g                = EXCLUDED.max_g,
    standard_deviation_g = EXCLUDED.standard_deviation_g,
    median_g             = EXCLUDED.median_g,
    status               = EXCLUDED.status;

-- Sensors: House 04 environment cluster + the House 02 NH3 sensor behind the incident.
INSERT INTO sensors (id, house_id, sensor_type_code, code, label, installed_at) VALUES
    ('SN-241-H4', 'H04', 'temperature', 'TEMP_H04',  'TEMP',  '2024-01-01T00:00:00Z'),
    ('SN-242-H4', 'H04', 'humidity',    'HUMID_H04', 'HUMID', '2024-01-01T00:00:00Z'),
    ('SN-243-H4', 'H04', 'co2',         'CO2_H04',   'CO2',   '2024-01-01T00:00:00Z'),
    ('SN-244-H4', 'H04', 'nh3',         'NH3_H04',   'NH3',   '2024-01-01T00:00:00Z'),
    ('SN-245-H4', 'H04', 'light',       'LIGHT_H04', 'LIGHT', '2024-01-01T00:00:00Z'),
    ('SN-246-H4', 'H04', 'airflow',     'AIRFLOW_H04','AIRFLOW','2024-01-01T00:00:00Z'),
    ('SN-482-H2', 'H02', 'nh3',         'NH3_H02',   'NH3',   '2024-01-01T00:00:00Z')
ON CONFLICT (id) DO UPDATE SET
    house_id         = EXCLUDED.house_id,
    sensor_type_code = EXCLUDED.sensor_type_code,
    code             = EXCLUDED.code,
    label            = EXCLUDED.label;

-- Sensor bounds (effective today; historical bounds would be added as new rows).
INSERT INTO sensor_bounds (sensor_id, lower_bound, upper_bound, display_label, effective_from) VALUES
    ('SN-241-H4', 22,   26,   '22-26 °C',       '2024-01-01'),
    ('SN-242-H4', 50,   70,   '50-70%',         '2024-01-01'),
    ('SN-243-H4', NULL, 3000, '<= 3,000 ppm',   '2024-01-01'),
    ('SN-244-H4', NULL, 25,   '<= 25 ppm',      '2024-01-01'),
    ('SN-245-H4', 20,   60,   '20-60 lx',       '2024-01-01'),
    ('SN-246-H4', 1.2,  2.5,  '1.2-2.5 m/s',    '2024-01-01'),
    ('SN-482-H2', NULL, 25,   '<= 25 ppm',      '2024-01-01')
ON CONFLICT (sensor_id, effective_from) DO UPDATE SET
    lower_bound   = EXCLUDED.lower_bound,
    upper_bound   = EXCLUDED.upper_bound,
    display_label = EXCLUDED.display_label;

-- Current readings (snapshot).
INSERT INTO sensor_readings (id, sensor_id, value, unit, status, recorded_at) VALUES
    (gen_random_uuid(), 'SN-241-H4', 24.2, '°C',  'nominal', '2024-05-24T21:10:00Z'),
    (gen_random_uuid(), 'SN-242-H4', 58,   '%',   'nominal', '2024-05-24T21:10:00Z'),
    (gen_random_uuid(), 'SN-243-H4', 1100, 'PPM', 'nominal', '2024-05-24T21:10:00Z'),
    (gen_random_uuid(), 'SN-244-H4', 3,    'PPM', 'nominal', '2024-05-24T21:10:00Z'),
    (gen_random_uuid(), 'SN-245-H4', 45,   'LX',  'nominal', '2024-05-24T21:10:00Z'),
    (gen_random_uuid(), 'SN-246-H4', 1.8,  'M/S', 'nominal', '2024-05-24T21:10:00Z'),
    (gen_random_uuid(), 'SN-482-H2', 3,    'PPM', 'nominal', '2024-05-24T21:10:00Z');

-- Cameras.
INSERT INTO cameras (id, house_id, mount_x, mount_y, fps, resolution, depth_points_per_frame, plan_view_label, online) VALUES
    ('UNIT_04_NORTH', 'H04', 45.021, 12.884, 60.2, '4K_UHD', 42000, 'UNIT_04_PLAN_VIEW', true),
    ('UNIT_02_NORTH', 'H02', 45.019, 12.871, 60.2, '4K_UHD', 42000, 'UNIT_02_PLAN_VIEW', true)
ON CONFLICT (id) DO UPDATE SET
    house_id               = EXCLUDED.house_id,
    mount_x                = EXCLUDED.mount_x,
    mount_y                = EXCLUDED.mount_y,
    fps                    = EXCLUDED.fps,
    resolution             = EXCLUDED.resolution,
    depth_points_per_frame = EXCLUDED.depth_points_per_frame,
    plan_view_label        = EXCLUDED.plan_view_label,
    online                 = EXCLUDED.online;

-- Incident + peak + evidence.
INSERT INTO incidents (id, house_id, title, started_at, ended_at, exceedance_minutes, activity_drop_percent, cause, resolution, status) VALUES
    ('INC-2024-0524-H02', 'H02', 'Ventilation failure — ammonia excursion',
        '2024-05-24T02:15:00Z', '2024-05-24T04:40:00Z', 142, 15.4,
        'Ventilation group B failure after a circuit breaker trip',
        'Ventilation restored; NH3 returned to 3 ppm',
        'resolved_monitoring')
ON CONFLICT (id) DO UPDATE SET
    title                 = EXCLUDED.title,
    started_at            = EXCLUDED.started_at,
    ended_at              = EXCLUDED.ended_at,
    exceedance_minutes    = EXCLUDED.exceedance_minutes,
    activity_drop_percent = EXCLUDED.activity_drop_percent,
    cause                 = EXCLUDED.cause,
    resolution            = EXCLUDED.resolution,
    status                = EXCLUDED.status;

INSERT INTO incident_peaks (incident_id, sensor_id, parameter, value, unit, threshold, baseline)
VALUES ('INC-2024-0524-H02', 'SN-482-H2', 'nh3', 28.4, 'PPM', 25, 5.5)
ON CONFLICT (incident_id) DO UPDATE SET
    sensor_id = EXCLUDED.sensor_id,
    parameter = EXCLUDED.parameter,
    value     = EXCLUDED.value,
    unit      = EXCLUDED.unit,
    threshold = EXCLUDED.threshold,
    baseline  = EXCLUDED.baseline;

INSERT INTO incident_peak_series (incident_id, sample_index, value) VALUES
    ('INC-2024-0524-H02', 0, 5.4),
    ('INC-2024-0524-H02', 1, 5.6),
    ('INC-2024-0524-H02', 2, 5.2),
    ('INC-2024-0524-H02', 3, 25.9),
    ('INC-2024-0524-H02', 4, 28.4),
    ('INC-2024-0524-H02', 5, 26.1),
    ('INC-2024-0524-H02', 6, 11.2),
    ('INC-2024-0524-H02', 7, 5.8)
ON CONFLICT (incident_id, sample_index) DO UPDATE SET value = EXCLUDED.value;

-- Alerts.
INSERT INTO alerts (id, facility_id, kind, severity, message, raised_at, acknowledged, acknowledged_at) VALUES
    ('ALT-2405-0440', 'FARM-001', 'CRITICAL_EVENT', 'critical',
        'Activity drop 15.4% detected in House 02. Sensor redundancy verified.',
        '2024-05-24T04:40:00Z', false, NULL),
    ('ALT-2405-0612', 'FARM-001', 'DEVIATION_LOG', 'deviation',
        'Weight deviation (-1.3% vs standard) in SEC_B cohort. Sampling rate adjusted.',
        '2024-05-24T06:12:00Z', false, NULL),
    ('ALT-2405-1210', 'FARM-001', 'ENV_REPORT', 'nominal',
        'Humidity sensor SN-242-H4 recalibrated automatically.',
        '2024-05-24T12:10:00Z', false, NULL),
    ('ALT-2405-1900', 'FARM-001', 'FEED_CYCLE', 'nominal',
        'Feed cycle 04 completed. Consumed 1,420 kg.',
        '2024-05-24T19:00:00Z', true, '2024-05-24T19:30:00Z')
ON CONFLICT (id) DO UPDATE SET
    kind         = EXCLUDED.kind,
    severity     = EXCLUDED.severity,
    message      = EXCLUDED.message,
    raised_at    = EXCLUDED.raised_at,
    acknowledged = EXCLUDED.acknowledged,
    acknowledged_at = EXCLUDED.acknowledged_at;

-- 24h anomaly timeline events.
INSERT INTO anomaly_events (id, facility_id, at, severity, label) VALUES
    ('ANM-0253', 'FARM-001', '2024-05-24T02:53:00Z', 'critical', 'NH3_SPIKE_H02'),
    ('ANM-0420', 'FARM-001', '2024-05-24T04:20:00Z', 'critical', 'ACTIVITY_DROP_H02'),
    ('ANM-1048', 'FARM-001', '2024-05-24T10:48:00Z', 'warning',  'FEED_DROPOUT_H01'),
    ('ANM-1453', 'FARM-001', '2024-05-24T14:53:00Z', 'warning',  'TEMP_EXCURSION_H03'),
    ('ANM-1940', 'FARM-001', '2024-05-24T19:40:00Z', 'warning',  'HUDDLING_CLUSTER_H04')
ON CONFLICT (id) DO UPDATE SET
    at       = EXCLUDED.at,
    severity = EXCLUDED.severity,
    label    = EXCLUDED.label;

-- Monitoring report and reference doc.
INSERT INTO monitoring_reports (id, facility_id, grounding_id, generated_at, last_scan_at)
VALUES ('IMR-2024-0524-8821', 'FARM-001', 'RAG-8821', '2024-05-24T21:10:00Z', '2024-05-24T21:08:44Z')
ON CONFLICT (id) DO UPDATE SET
    grounding_id = EXCLUDED.grounding_id,
    generated_at = EXCLUDED.generated_at,
    last_scan_at = EXCLUDED.last_scan_at;

INSERT INTO reference_docs (id, quote, cited_threshold, unit, document_ref) VALUES
    ('MANUAL_VOL_II_SEC_4.2',
        'Ammonia levels above 20ppm cause respiratory irritation in broiler populations, leading to reduced movement and huddling behavior.',
        20, 'ppm', 'Manual Volume II, Section 4.2')
ON CONFLICT (id) DO UPDATE SET
    quote           = EXCLUDED.quote,
    cited_threshold = EXCLUDED.cited_threshold,
    unit            = EXCLUDED.unit,
    document_ref    = EXCLUDED.document_ref;

-- Archive.
INSERT INTO archived_reports (id, title, format, generated_at, size_mb, is_featured, note) VALUES
    ('RPT-DHS-20240523', 'Daily Health Summary',            'PDF_EXPORT', '2024-05-23T22:00:00Z', 2.4, false, NULL),
    ('RPT-ENV-20240523', 'Environment Audit v4',            'CSV_RAW',    '2024-05-23T22:05:00Z', 8.1, false, NULL),
    ('RPT-GEN-W21',      'Weekly Genetic Trend Projection', 'PDF_EXPORT', '2024-05-24T19:10:00Z', 4.6, true,  'Week 21 Analysis')
ON CONFLICT (id) DO UPDATE SET
    title        = EXCLUDED.title,
    format       = EXCLUDED.format,
    generated_at = EXCLUDED.generated_at,
    size_mb      = EXCLUDED.size_mb,
    is_featured  = EXCLUDED.is_featured,
    note         = EXCLUDED.note;
