# Entity-Relationship (ER) Schema Diagram - 8 Core Tables

The database schema uses PostgreSQL 18 with 64-bit auto-incrementing numeric IDs (`BIGSERIAL`), `TIMESTAMPTZ` timestamps, and explicit foreign key cascades or restrictions.

```mermaid
erDiagram
    users ||--o| profiles : "has one (1:1)"
    users ||--o| doctors : "specializes as (1:1)"
    users ||--o{ consultations : "attends as patient (1:N)"
    users ||--o{ prescriptions : "receives as patient (1:N)"
    users ||--o{ audit_logs : "initiates as actor (1:N)"

    doctors ||--o{ availability_slots : "schedules (1:N)"
    doctors ||--o{ consultations : "conducts (1:N)"
    doctors ||--o{ prescriptions : "issues (1:N)"

    availability_slots ||--o| consultations : "reserved by (1:1)"
    consultations ||--o{ prescriptions : "results in (1:N)"
    consultations ||--o| payments : "billed under (1:1)"

    users {
        BIGSERIAL id PK
        VARCHAR name
        VARCHAR email UK
        VARCHAR password_hash
        VARCHAR role "patient | doctor | admin"
        VARCHAR status "active | inactive | suspended"
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    profiles {
        BIGSERIAL id PK
        BIGINT user_id FK, UK
        VARCHAR phone
        DATE date_of_birth
        VARCHAR gender
        TEXT address
        VARCHAR emergency_contact
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    doctors {
        BIGSERIAL id PK
        BIGINT user_id FK, UK
        VARCHAR specialization
        VARCHAR qualification
        INT experience_years "CHECK >= 0"
        NUMERIC consultation_fee "CHECK >= 0"
        VARCHAR verification_status "pending | verified | rejected"
        TEXT bio
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    availability_slots {
        BIGSERIAL id PK
        BIGINT doctor_id FK
        TIMESTAMPTZ start_time
        TIMESTAMPTZ end_time
        VARCHAR status "available | booked | cancelled"
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    consultations {
        BIGSERIAL id PK
        BIGINT patient_id FK
        BIGINT doctor_id FK
        BIGINT availability_slot_id FK, UK
        VARCHAR booking_reference UK
        VARCHAR status "booked | confirmed | in_progress | completed | cancelled | no_show"
        TIMESTAMPTZ started_at
        TIMESTAMPTZ ended_at
        TEXT notes
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    prescriptions {
        BIGSERIAL id PK
        BIGINT consultation_id FK
        BIGINT doctor_id FK
        BIGINT patient_id FK
        JSONB prescription_details
        TEXT notes
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    payments {
        BIGSERIAL id PK
        BIGINT consultation_id FK, UK
        NUMERIC amount "CHECK >= 0"
        VARCHAR currency
        VARCHAR status "pending | completed | failed | refunded"
        VARCHAR provider_reference
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    audit_logs {
        BIGSERIAL id PK
        BIGINT actor_user_id FK
        VARCHAR action
        VARCHAR entity_type
        BIGINT entity_id
        VARCHAR request_id
        TIMESTAMPTZ timestamp
        JSONB metadata
    }
```
