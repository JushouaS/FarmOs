-- 0014_nonnegative_constraints.sql
-- Phase 1 audit finding: no table enforced non-negative values on feed,
-- weight, water, population, or linear-dimension columns at the DB layer —
-- only at the application (Zod) layer where a write path exists at all, and
-- most of these tables currently have no write path yet. These constraints
-- are defense-in-depth for when the ingestion endpoints land. NULL-tolerant
-- wherever the column itself is nullable.

ALTER TABLE houses
    ADD CONSTRAINT houses_population_nonneg CHECK (population >= 0);

ALTER TABLE feed_samples
    ADD CONSTRAINT feed_samples_consumed_kg_nonneg CHECK (consumed_kg IS NULL OR consumed_kg >= 0),
    ADD CONSTRAINT feed_samples_fcr_nonneg         CHECK (fcr IS NULL OR fcr >= 0),
    ADD CONSTRAINT feed_samples_adg_g_nonneg       CHECK (adg_g IS NULL OR adg_g >= 0);

ALTER TABLE cycle_weights
    ADD CONSTRAINT cycle_weights_actual_g_nonneg   CHECK (actual_g >= 0),
    ADD CONSTRAINT cycle_weights_standard_g_nonneg CHECK (standard_g >= 0);

ALTER TABLE water_samples
    ADD CONSTRAINT water_samples_litres_nonneg CHECK (litres_per_hour >= 0);

ALTER TABLE activity_samples
    ADD CONSTRAINT activity_samples_value_nonneg CHECK (value >= 0);

ALTER TABLE detections
    ADD CONSTRAINT detections_weight_g_nonneg   CHECK (estimated_weight_g IS NULL OR estimated_weight_g >= 0),
    ADD CONSTRAINT detections_weight_conf_range CHECK (weight_confidence IS NULL OR (weight_confidence >= 0 AND weight_confidence <= 1));

ALTER TABLE volumetric_samples
    ADD CONSTRAINT volumetric_breast_width_nonneg CHECK (breast_width_mm IS NULL OR breast_width_mm >= 0),
    ADD CONSTRAINT volumetric_total_length_nonneg CHECK (total_length_mm IS NULL OR total_length_mm >= 0),
    ADD CONSTRAINT volumetric_depth_z_nonneg      CHECK (depth_z_mm IS NULL OR depth_z_mm >= 0),
    ADD CONSTRAINT volumetric_mass_g_nonneg       CHECK (calculated_mass_g IS NULL OR calculated_mass_g >= 0);
