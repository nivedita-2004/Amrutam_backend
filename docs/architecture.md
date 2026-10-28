# Amrutam Telemedicine Backend - Architecture Documentation

## 1. System Overview
Amrutam Telemedicine Backend is a production-grade, secure RESTful API built for an Ayurvedic telemedicine platform. It bridges patients seeking holistic healthcare with certified Ayurvedic doctors, facilitating appointments, consultations, prescriptions, and payments.

## 2. Technology Stack & Architectural Style
- **Runtime**: Node.js (LTS v20+)
- **HTTP Server**: Express.js (v5)
- **Module System**: CommonJS
- **Database**: PostgreSQL 18 with connection pooling via `pg` (no ORM)
- **Pattern**: Classic MVC-style with decoupled layers:
  - `controllers/`: HTTP lifecycle, request/response orchestration, status codes.
  - `query/`: Pure, parameterized SQL queries isolated from controllers.
  - `routes/`: Endpoint path declarations with middleware pipelines.
  - `middleware/`: Authentication, RBAC, input validation, rate limiting, request tracing.
  - `validators/`: Strict payload contracts enforced via Zod schemas.
  - `utils/`: Reusable primitives (`ApiError`, `asyncHandler`, `logger`).
  - `config/`: Singleton database connection pool and environment validation.

## 3. Core Database Tables (8 Tables + Internal Migration Tracking)
1. **`users`**: Patient, Doctor, and Admin accounts.
2. **`profiles`**: User demographic and contact details.
3. **`doctors`**: Certified Ayurvedic doctor profiles and consultation fees.
4. **`availability_slots`**: Calendar availability slots with `start_time < end_time`.
5. **`consultations`**: Unified appointment reservation and clinical telemedicine lifecycle.
6. **`prescriptions`**: Structured Ayurvedic prescriptions linked to consultations.
7. **`payments`**: Consultation fee payment records with retry-safe upserts.
8. **`audit_logs`**: Regulatory security audit trail with JSONB metadata.

*Internal System Table*:
- **`schema_migrations`**: Internal migration history tracked automatically by `database/migrate.js`.

## 4. Key Design Principles
- **No Heavy ORMs**: Direct SQL ensures full transparency, predictable query execution plans, and prevents N+1 query surprises.
- **Strong Concurrency Guarantees**:
  - Availability slot reservation uses explicit row-level locking (`FOR UPDATE`) within PostgreSQL transactions.
  - Partial unique indexes (`uq_consultations_active_slot`) prevent duplicate active bookings at the database level.
- **Fail-Safe Migrations**:
  - Migrations are version-controlled, executed sequentially in transactions, and protected by PostgreSQL advisory locks (`pg_advisory_lock`) to prevent race conditions during distributed deployments.
- **Defensive Error Handling**:
  - Centralized error handler captures all synchronous and asynchronous errors via `asyncHandler`.
  - Database credentials and internal system details are never exposed to clients.
