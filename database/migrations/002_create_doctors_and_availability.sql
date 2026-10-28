-- 002_create_doctors_and_availability.sql
-- Migration 2: Doctor Profiles and Availability Slots

BEGIN;

CREATE TABLE IF NOT EXISTS doctors (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    specialization VARCHAR(100) NOT NULL,
    qualification VARCHAR(255) NOT NULL,
    experience_years INT NOT NULL DEFAULT 0,
    consultation_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    verification_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    bio TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_doctors_experience CHECK (experience_years >= 0),
    CONSTRAINT chk_doctors_fee CHECK (consultation_fee >= 0),
    CONSTRAINT chk_doctors_verification CHECK (verification_status IN ('pending', 'verified', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_doctors_specialization ON doctors (specialization);
CREATE INDEX IF NOT EXISTS idx_doctors_verification_status ON doctors (verification_status);
CREATE INDEX IF NOT EXISTS idx_doctors_user_id ON doctors (user_id);

CREATE TABLE IF NOT EXISTS availability_slots (
    id BIGSERIAL PRIMARY KEY,
    doctor_id BIGINT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'available',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_slot_time_range CHECK (start_time < end_time),
    CONSTRAINT chk_slot_status CHECK (status IN ('available', 'booked', 'cancelled')),
    CONSTRAINT uq_doctor_slot_start UNIQUE (doctor_id, start_time)
);

CREATE INDEX IF NOT EXISTS idx_availability_doctor_start ON availability_slots (doctor_id, start_time);
CREATE INDEX IF NOT EXISTS idx_availability_status ON availability_slots (status);

COMMIT;
