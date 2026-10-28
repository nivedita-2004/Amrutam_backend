-- 001_seed_dev_data.sql
-- Development seed data (NOT for production use)

BEGIN;

-- Insert dev patient and doctor users if not present
INSERT INTO users (id, name, email, password_hash, role, status)
VALUES 
    (1, 'Dev Test Patient', 'patient.dev@example.com', '$2b$10$devplaceholderhashonlynotforproduction0000000000000000', 'patient', 'active'),
    (2, 'Dr. Dev Ayurvedic', 'doctor.dev@example.com', '$2b$10$devplaceholderhashonlynotforproduction0000000000000000', 'doctor', 'active'),
    (3, 'Dev Administrator', 'admin.dev@example.com', '$2b$10$devplaceholderhashonlynotforproduction0000000000000000', 'admin', 'active')
ON CONFLICT (id) DO NOTHING;

-- Insert profile for test users
INSERT INTO profiles (user_id, phone, gender, address)
VALUES 
    (1, '+91-9876543210', 'female', 'Dev Street, Test City'),
    (2, '+91-9876543211', 'male', 'Clinic Block B, Test City')
ON CONFLICT (user_id) DO NOTHING;

-- Insert doctor profile
INSERT INTO doctors (id, user_id, specialization, qualification, experience_years, consultation_fee, verification_status, bio)
VALUES 
    (1, 2, 'Kayachikitsa (Internal Medicine)', 'BAMS, MD (Ayurveda)', 8, 500.00, 'verified', 'Specialist in holistic lifestyle and metabolic balance.')
ON CONFLICT (id) DO NOTHING;

-- Reset sequence to prevent collision
SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 1) FROM users));
SELECT setval('profiles_id_seq', (SELECT COALESCE(MAX(id), 1) FROM profiles));
SELECT setval('doctors_id_seq', (SELECT COALESCE(MAX(id), 1) FROM doctors));

COMMIT;
