-- 003_create_consultations_and_prescriptions.sql
-- Migration 3: Unified Consultations (Bookings) and Clinical Prescriptions

BEGIN;

CREATE TABLE IF NOT EXISTS consultations (
    id BIGSERIAL PRIMARY KEY,
    patient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    doctor_id BIGINT NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
    availability_slot_id BIGINT NOT NULL REFERENCES availability_slots(id) ON DELETE RESTRICT,
    booking_reference VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'booked',
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_consultation_status CHECK (
        status IN ('booked', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')
    ),
    CONSTRAINT chk_consultation_times CHECK (
        started_at IS NULL OR ended_at IS NULL OR started_at <= ended_at
    )
);

-- Crucial: Prevents double-booking of any slot while a consultation is active
CREATE UNIQUE INDEX IF NOT EXISTS uq_consultations_active_slot 
    ON consultations (availability_slot_id) 
    WHERE status NOT IN ('cancelled');

CREATE INDEX IF NOT EXISTS idx_consultations_patient ON consultations (patient_id);
CREATE INDEX IF NOT EXISTS idx_consultations_doctor ON consultations (doctor_id);
CREATE INDEX IF NOT EXISTS idx_consultations_status ON consultations (status);
CREATE INDEX IF NOT EXISTS idx_consultations_created_at ON consultations (created_at);

CREATE TABLE IF NOT EXISTS prescriptions (
    id BIGSERIAL PRIMARY KEY,
    consultation_id BIGINT NOT NULL REFERENCES consultations(id) ON DELETE RESTRICT,
    doctor_id BIGINT NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
    patient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    prescription_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_consultation ON prescriptions (consultation_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions (patient_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_doctor ON prescriptions (doctor_id);

COMMIT;
