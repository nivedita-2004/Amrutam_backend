-- 005_add_availability_slot_exclusion_constraint.sql
-- Migration 5: Prevent overlapping availability slots for the same doctor at the database level

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE availability_slots
    ADD CONSTRAINT uq_doctor_slot_no_overlap
    EXCLUDE USING gist (
        doctor_id WITH =,
        tstzrange(start_time, end_time) WITH &&
    )
    WHERE (status != 'cancelled');

COMMIT;
