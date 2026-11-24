-- Register the Kinect source used by the Pi's offline analysis queue and give
-- its volumetric weight samples a dedicated sensor instead of attaching them
-- to an unrelated environmental sensor in the same house.
INSERT INTO cameras (id, house_id, online)
VALUES ('KINECT-01', 'H02', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO sensor_types (code, label, unit, display_format)
VALUES ('weight', 'Volumetric weight', 'g', '{decimals:1}')
ON CONFLICT (code) DO NOTHING;

INSERT INTO sensors (id, house_id, sensor_type_code, code, label, serial, installed_at)
VALUES ('SN-KINECT-01', 'H02', 'weight', 'WEIGHT_H02', 'KINECT', 'KINECT', now())
ON CONFLICT (id) DO NOTHING;
