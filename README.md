


# Amrutam Telemedicine Backend

## 1. Project Overview & Technology Stack

The **Amrutam Telemedicine Backend** delivers a complete Ayurvedic consultation workflow: user authentication with role-based access control (Patient, Doctor, Admin), doctor discovery and availability management, concurrent race-protected consultation booking with request-level idempotency, clinical prescriptions, internal payment records, administrative verification, and audit logging.

### Technology Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Runtime** | Node.js | `>=20.0.0` (LTS 20 / 22) | Server-side JavaScript runtime |
| **Framework** | Express.js | `^5.3.0` | Fast, minimalist web framework |
| **Database** | PostgreSQL | `17` or `18` | Relational database with GiST and transaction support |
| **Driver** | `pg` (node-postgres) | `^8.23.1` | Native connection pooling and parameterized SQL |
| **Security** | `helmet`, `cors`, `bcryptjs` | `^8.3.0`, `^2.8.6`, `^3.0.3` | HTTP header hardening, CORS, password hashing (cost=10) |
| **Authentication** | `jsonwebtoken`, `cookie-parser` | `^9.0.3`, `^1.4.7` | HMAC-SHA256 JWTs and HTTP-only cookie session handling |
| **Validation** | `zod` | `^4.6.7` | Runtime request schema validation |
| **Rate Limiting** | `express-rate-limit` | `^8.7.1` | In-memory sliding-window request throttling |
| **Logging** | `pino`, `pino-http` | `^10.4.0`, `^11.0.0` | High-speed structured JSON logging with request correlation |
| **Testing** | `jest`, `supertest` | `^30.5.2`, `^7.3.1` | Unit, integration, and end-to-end API testing |

---

## 2. Database Architecture & Schema

The schema is partitioned into **8 Core Business Tables** and **3 Supporting Infrastructure Tables**. All tables use explicit foreign key constraints, `TIMESTAMPTZ` columns, and defensive indexing.

### 2.1 Core Business Tables

| Table | Primary Key | Description | Key Constraints & Relationships |
|---|---|---|---|
| **`users`** | `id` (BIGSERIAL) | Identity credentials and global account status | `email UNIQUE`, `role IN ('patient', 'doctor', 'admin')`, `status IN ('active', 'suspended')` |
| **`profiles`** | `id` (BIGSERIAL) | Patient demographic and contact details | `user_id UNIQUE REFERENCES users(id) ON DELETE CASCADE` |
| **`doctors`** | `id` (BIGSERIAL) | Professional Ayurvedic credentials and fees | `user_id UNIQUE REFERENCES users(id) ON DELETE CASCADE`, `verification_status IN ('pending', 'verified', 'rejected')` |
| **`availability_slots`** | `id` (BIGSERIAL) | Doctor calendar scheduling slots | `doctor_id REFERENCES doctors(id) ON DELETE CASCADE`, `status IN ('available', 'booked', 'cancelled')`, `CHECK (start_time < end_time)`, GiST non-overlapping exclusion constraint |
| **`consultations`** | `id` (BIGSERIAL) | Clinical consultation session lifecycle | `booking_reference UNIQUE`, `patient_id REFERENCES users(id)`, `doctor_id REFERENCES doctors(id)`, `availability_slot_id REFERENCES availability_slots(id)`, `status IN ('booked', 'completed', 'cancelled')`, partial unique index on slot |
| **`prescriptions`** | `id` (BIGSERIAL) | Clinical Ayurvedic remedies and advice | `consultation_id UNIQUE REFERENCES consultations(id)`, `patient_id REFERENCES users(id)`, `doctor_id REFERENCES doctors(id)`, `prescription_details JSONB` |
| **`payments`** | `id` (BIGSERIAL) | Consultation billing ledger records | `consultation_id UNIQUE REFERENCES consultations(id)`, `currency DEFAULT 'INR'`, `status IN ('pending', 'completed', 'failed', 'refunded')` |
| **`audit_logs`** | `id` (BIGSERIAL) | Immutable security and regulatory event log | `actor_user_id REFERENCES users(id) ON DELETE SET NULL`, `metadata JSONB` |

### 2.2 Supporting & Infrastructure Tables

| Table | Primary Key | Description | Purpose & Mechanics |
|---|---|---|---|
| **`idempotency_keys`** | `id` (BIGSERIAL) | Request-level idempotency record store | `UNIQUE(user_id, operation, key)`. Stores request SHA-256 hash, status (`processing`, `completed`), HTTP status code, and cached JSON response body for atomic replay (Migration `007`). |
| **`refresh_tokens`** | `id` (BIGSERIAL) | Refresh-token rotation and reuse tracking | Stores SHA-256 hash of refresh tokens grouped by `family_id (UUID)`. Protects against token replay and credential theft (Migration `006`). |
| **`schema_migrations`** | `id` (SERIAL) | Internal migration tracking | Maintained by `database/migrate.js` with advisory locking (`pg_advisory_lock`) to track applied `.sql` migrations. |

### 2.3 Active Concurrency & Integrity Constraints

1. **Availability Slot Overlap Exclusion (`uq_doctor_slot_no_overlap`)**:
   PostgreSQL GiST exclusion constraint (`btree_gist` extension) ensuring no doctor can have overlapping active slots:
   ```sql
   EXCLUDE USING gist (
     doctor_id WITH =,
     tstzrange(start_time, end_time, '[)') WITH &&
   ) WHERE (status != 'cancelled');
   ```
2. **Double-Booking Partial Unique Index (`uq_consultations_active_slot`)**:
   Ensures an availability slot cannot have more than one active consultation:
   ```sql
   CREATE UNIQUE INDEX uq_consultations_active_slot
   ON consultations (availability_slot_id)
   WHERE status IN ('booked', 'completed');
   ```
3. **Consultation Idempotency Compound Constraint (`uq_idempotency_user_op_key`)**:
   Enforces uniqueness per user, operation, and idempotency key:
   ```sql
   CONSTRAINT uq_idempotency_user_op_key UNIQUE (user_id, operation, key)
   ```

---

## 3. Local Development Setup

The Amrutam Telemedicine Backend runs directly on your local system using Node.js, npm, and a native PostgreSQL database. Docker is not required.

### Prerequisites
- **Node.js**: v20+ or v22+ LTS (`node -v`)
- **npm**: v10+ or v11+ (`npm -v`)
- **PostgreSQL**: v17 or v18 running locally on port 5432 (`psql --version`)

### Step 1: Clone & Install Dependencies
```bash
git clone https://github.com/nivedita-2004/Amrutam_backend.git
cd Amrutum_assessement
npm install
```

### Step 2: Create Local Database
Using `psql` or pgAdmin 4:
```sql
CREATE DATABASE amrutam_db;
```

### Step 3: Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
# On Linux / macOS:
cp .env.example .env

# On Windows PowerShell:
Copy-Item .env.example .env
```
Update `.env` with your local database credentials:
```ini
PORT=5000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/amrutam_db
DB_POOL_MAX=10
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=5000

JWT_SECRET=your_super_secret_jwt_key_min_32_chars_change_in_production
ACCESS_TOKEN_EXPIRES_IN=7m
REFRESH_TOKEN_EXPIRES_IN=15d

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_GLOBAL_MAX=200
RATE_LIMIT_LOGIN_MAX=10
RATE_LIMIT_SIGNUP_MAX=10
RATE_LIMIT_REFRESH_MAX=30
RATE_LIMIT_PASSWORD_RESET_MAX=5

CORS_ORIGIN=*
LOG_LEVEL=info
```
> **Security Notice**: Never commit `.env` or disclose real database passwords. `.env` is ignored by `.gitignore`.

### Step 4: Run Migrations & Seed
```bash
# Apply all 7 database migrations
npm run db:migrate

# Seed sample development data (patients, doctors, admin)
npm run db:seed
```

### Step 5: Start Server
```bash
# Start with hot-reload (nodemon)
npm run dev

# Or start in standard production mode
npm start
```
The server will bind to `http://localhost:5000`.

### Step 6: Verify Health Probes
```bash
# Check liveness probe
curl -i http://localhost:5000/health/live

# Check database readiness probe
curl -i http://localhost:5000/health/ready
```

### Step 7: Run Automated Tests
```bash
npm test
```

---

## 4. Database Migrations & Seeding

Migrations are executed sequentially by `database/migrate.js`. The runner acquires a PostgreSQL session advisory lock (`pg_advisory_lock`) to serialize concurrent migration runs safely.

### Migration Files
1. `001_create_users_and_profiles.sql`: Creates `users` and `profiles` tables with foreign keys and status constraints.
2. `002_create_doctors_and_availability.sql`: Creates `doctors` and `availability_slots` tables.
3. `003_create_consultations_and_prescriptions.sql`: Creates `consultations` and `prescriptions` tables with partial unique index `uq_consultations_active_slot`.
4. `004_create_payments_and_audit_logs.sql`: Creates `payments` and `audit_logs` tables.
5. `005_add_availability_slot_exclusion_constraint.sql`: Enables `btree_gist` extension and adds GiST exclusion constraint `uq_doctor_slot_no_overlap`.
6. `006_create_refresh_tokens.sql`: Creates `refresh_tokens` table for SHA-256 token rotation and family reuse detection.
7. `007_create_idempotency_keys.sql`: Creates `idempotency_keys` table for request-level consultation booking idempotency.

### CLI Migration Commands
```bash
# Run pending migrations
npm run db:migrate

# Seed development data
npm run db:seed

# Optional: Backfill missing doctor records
npm run db:backfill-doctors
```

---

## 5. Repository Structure

```
Amrutum_assessement/
├── .github/
│   └── workflows/
│       └── ci.yml                      # GitHub Actions CI matrix (Node 20.x, 22.x + Postgres 17)
├── database/
│   ├── backups/
│   │   └── schema_backup_v1_12_tables.sql
│   ├── migrations/
│   │   ├── 001_create_users_and_profiles.sql
│   │   ├── 002_create_doctors_and_availability.sql
│   │   ├── 003_create_consultations_and_prescriptions.sql
│   │   ├── 004_create_payments_and_audit_logs.sql
│   │   ├── 005_add_availability_slot_exclusion_constraint.sql
│   │   ├── 006_create_refresh_tokens.sql
│   │   └── 007_create_idempotency_keys.sql
│   ├── scripts/
│   │   └── backfill_doctors.js         # Maintenance utility for doctor profiles
│   ├── seeds/
│   │   └── 001_seed_dev_data.sql       # Demo patients, doctors, and admin
│   ├── migrate.js                      # Transactional advisory-locked migration runner
│   └── seed.js                         # Development seed executor
├── docs/
│   ├── diagrams/
│   │   └── er-diagram.md               # Entity-relationship diagrams
│   ├── architecture.md                 # System architecture overview
│   ├── backup-and-recovery.md          # Disaster recovery specifications
│   ├── security-checklist.md           # Security hardening guidelines
│   └── threat-model.md                 # Threat assessment documentation
├── src/
│   ├── config/
│   │   └── db.js                       # pg.Pool configuration and lifecycle hooks
│   ├── controller/
│   │   ├── admin.controller.js         # Metrics, pending doctors, doctor verification
│   │   ├── auth.controller.js          # Signup, login, refresh rotation, logout, me
│   │   ├── availability.controller.js  # Slot creation, queries, updates, deletions
│   │   ├── consultation.controller.js  # Transactional booking, cancellation, idempotency
│   │   ├── doctor.controller.js        # Doctor directory and profile management
│   │   ├── payment.controller.js       # Internal billing ledger records
│   │   ├── prescription.controller.js  # Clinical prescription creation and retrieval
│   │   └── user.controller.js          # Patient demographic profile management
│   ├── middleware/
│   │   ├── auth.middleware.js          # JWT verification from cookie or Bearer header
│   │   ├── error.middleware.js         # Centralized API error handling
│   │   ├── optionalAuth.middleware.js  # Non-blocking JWT verification for public routes
│   │   ├── rateLimit.middleware.js     # Endpoint-specific in-memory rate limiting
│   │   ├── requestId.middleware.js     # X-Request-Id correlation generator/validator
│   │   ├── role.middleware.js          # RBAC authorization guard (patient/doctor/admin)
│   │   └── validate.middleware.js      # Zod schema request validator
│   ├── query/
│   │   ├── admin.query.js
│   │   ├── audit.query.js
│   │   ├── auth.query.js
│   │   ├── availability.query.js
│   │   ├── consultation.query.js
│   │   ├── doctor.query.js
│   │   ├── idempotency.query.js
│   │   ├── payment.query.js
│   │   ├── prescription.query.js
│   │   ├── refreshToken.query.js
│   │   └── user.query.js
│   ├── routes/
│   │   ├── admin.route.js
│   │   ├── auth.route.js
│   │   ├── availability.route.js
│   │   ├── consultation.route.js
│   │   ├── doctor.route.js
│   │   ├── payment.route.js
│   │   ├── prescription.route.js
│   │   └── user.route.js
│   ├── utils/
│   │   ├── logger.js      # Pino logger instance           
│   │
│   │                    
│   ├── validators/
│   │   ├── auth.validator.js
│   │   ├── availability.validator.js
│   │   ├── consultation.validator.js
│   │   ├── doctor.validator.js
│   │   ├── prescription.validator.js
│   │   └── user.validator.js
│   └── app.js                          # Express application assembly and middleware stack
├── tests/
│   ├── api/
│   │   ├── admin.test.js               # Admin verification and metrics tests (10 tests)
│   │   ├── audit.test.js               # Audit log persistence and redaction (6 tests)
│   │   ├── auth.test.js                # Signup, login, logout, me tests (22 tests)
│   │   ├── booking.test.js             # Concurrency, row locking, cancellation (75 tests)
│   │   ├── health.test.js              # Liveness and readiness tests (2 tests)
│   │   ├── idempotency.test.js         # Booking idempotency and replay tests (9 tests)
│   │   ├── profile.test.js             # Patient & doctor profile update tests (22 tests)
│   │   ├── rateLimit.test.js           # Rate limiting and HTTP 429 tests (5 tests)
│   │   └── refreshToken.test.js        # Token rotation & reuse detection (12 tests)
│   ├── integration/
│   │   └── routeScaffold.test.js       # Route registration and 404 handler (1 test)
│   └── unit/
│       └── db.test.js                  # Database connection pool tests (3 tests)
├── .env.example
├── .gitignore
├── ARCHITECTURE.md                     # Comprehensive backend architecture document
├── openapi.yaml                        # Complete OpenAPI 3.0.3 specification
├── package.json                        # Dependencies, scripts, and Jest configuration
├── package-lock.json
├── README.md                           # Reviewer-facing documentation
└── server.js                           # Server entry point with graceful shutdown
```

---

## 6. Authentication & Session Management

Authentication uses short-lived JWT access tokens accompanied by atomic refresh-token rotation stored in PostgreSQL.

### Cookie vs. Header Delivery
- **Access Token**: Sent in an HTTP-only cookie named `accessToken` (duration: 7 minutes) and also accepted via `Authorization: Bearer <token>`.
- **Refresh Token**: Sent in an HTTP-only cookie named `refreshToken` (duration: 15 days) and also accepted via request body `{ "refreshToken": "..." }`.
- **Security Attributes**: Cookies are marked `httpOnly: true`, `sameSite: 'strict'` (or `'lax'` in development), and `secure: true` in production.

### Endpoints (`/api/auth`)

#### 1. Register User (`POST /api/auth/signup`)
Registers a new user (`patient` or `doctor`). Self-registration as `admin` is blocked (403). Automatically hashes password with `bcryptjs` and sets `accessToken` and `refreshToken` cookies.
- **Request Body**:
  ```json
  {
    "name": "Sita Sharma",
    "email": "sita.sharma@example.com",
    "password": "SecurePassword123!",
    "role": "patient"
  }
  ```
- **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "User registered successfully",
    "data": {
      "user": {
        "id": "1",
        "name": "Sita Sharma",
        "email": "sita.sharma@example.com",
        "role": "patient",
        "status": "active",
        "created_at": "2026-10-28T00:00:00.000Z"
      }
    }
  }
  ```

#### 2. Log In (`POST /api/auth/login`)
Authenticates email and password. Generates new token family, sets `accessToken` and `refreshToken` cookies, and logs the event to `audit_logs`.
- **Request Body**:
  ```json
  {
    "email": "sita.sharma@example.com",
    "password": "SecurePassword123!"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "user": {
        "id": "1",
        "name": "Sita Sharma",
        "email": "sita.sharma@example.com",
        "role": "patient",
        "status": "active"
      }
    }
  }
  ```

#### 3. Rotate & Refresh Tokens (`POST /api/auth/refresh`)
Performs atomic refresh-token rotation with automatic reuse detection:
- Reads `refreshToken` from cookie or JSON body.
- Hashes token using SHA-256 and checks against `refresh_tokens` table with row-level lock (`SELECT ... FOR UPDATE`).
- If an already-rotated or revoked token is reused, revokes the **entire token family** (`family_id`), deletes authentication cookies, and logs a security event.
- If valid, revokes the old token, issues a new token pair, and sets updated cookies.
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Tokens refreshed successfully",
    "data": {
      "user": {
        "id": "1",
        "role": "patient"
      }
    }
  }
  ```

#### 4. Log Out (`POST /api/auth/logout`)
Revokes the active refresh token in PostgreSQL and clears cookies on the client.
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Logged out successfully"
  }
  ```

#### 5. Current User Profile (`GET /api/auth/me`)
Retrieves the authenticated user's account details and profile.
- **Headers / Cookie**: `Authorization: Bearer <token>` or Cookie `accessToken=<token>`
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "id": "1",
        "name": "Sita Sharma",
        "email": "sita.sharma@example.com",
        "role": "patient",
        "status": "active",
        "profile": {
          "phone": "+919876543210",
          "date_of_birth": "1992-06-14",
          "gender": "female",
          "address": "42 Ayurveda Marg, Varanasi, UP",
          "emergency_contact": "Ramesh Sharma: +919876500000"
        }
      }
    }
  }
  ```

---

## 7. Patient Profile API

Endpoints under `/api/users` manage patient demographic information.

### 1. Get Own Profile (`GET /api/users/profile`)
- **Access**: Authenticated (`patient`, `doctor`, or `admin`)
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "profile": {
        "id": "1",
        "name": "Sita Sharma",
        "email": "sita.sharma@example.com",
        "role": "patient",
        "status": "active",
        "phone": "+919876543210",
        "date_of_birth": "1992-06-14",
        "gender": "female",
        "address": "42 Ayurveda Marg, Varanasi, UP",
        "emergency_contact": "Ramesh Sharma: +919876500000",
        "created_at": "2026-10-28T00:00:00.000Z",
        "updated_at": "2026-10-28T00:00:00.000Z"
      }
    }
  }
  ```

### 2. Update Own Profile (`PUT /api/users/profile`)
Allows partial updates while preserving omitted fields. Validated by Zod against protected fields (`id`, `user_id`, `role`, `status`).
- **Access**: Authenticated (`patient`)
- **Request Body**:
  ```json
  {
    "phone": "+919876543210",
    "address": "108 Ganga Ghat, Varanasi, UP",
    "emergency_contact": "Ramesh Sharma: +919876500000"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Profile updated successfully",
    "data": {
      "profile": {
        "id": "1",
        "name": "Sita Sharma",
        "email": "sita.sharma@example.com",
        "role": "patient",
        "status": "active",
        "phone": "+919876543210",
        "date_of_birth": "1992-06-14",
        "gender": "female",
        "address": "108 Ganga Ghat, Varanasi, UP",
        "emergency_contact": "Ramesh Sharma: +919876500000",
        "updated_at": "2026-10-28T01:15:00.000Z"
      }
    }
  }
  ```

---

## 8. Doctor Directory & Profile API

Endpoints under `/api/doctors` provide public discovery and doctor credential management.

### Key Distinction: `doctors.id` vs. `doctors.user_id`
- `doctors.id`: The primary key of the doctor's clinical profile. Used in availability scheduling, consultation booking, admin verification, and public URLs (`/api/doctors/:id`).
- `doctors.user_id`: Foreign key reference to `users.id`. Used during authentication and login.
Both identifiers are exposed in doctor responses to prevent confusion.

### 1. List Verified Doctors (`GET /api/doctors`)
Public directory returning active, verified Ayurvedic doctors sorted by clinical experience.
- **Access**: Public / Authenticated
- **Query Parameters**:
  - `specialization` (optional): Case-insensitive keyword search (`ILIKE`).
  - `limit` (optional): Pagination limit (integer, default `20`).
  - `offset` (optional): Pagination offset (integer, default `0`).
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "doctors": [
        {
          "id": "1",
          "user_id": "10",
          "name": "Dr. Aarav Patel",
          "email": "dr.aarav@example.com",
          "specialization": "Kayachikitsa & Panchakarma",
          "qualification": "BAMS, MD (Ayurveda)",
          "experience_years": 14,
          "consultation_fee": "750.00",
          "verification_status": "verified",
          "bio": "Ayurvedic specialist focusing on chronic digestive wellness.",
          "created_at": "2026-10-28T00:00:00.000Z",
          "updated_at": "2026-10-28T00:00:00.000Z"
        }
      ]
    }
  }
  ```

### 2. Get Doctor Details (`GET /api/doctors/:id`)
Retrieves doctor details by doctor profile ID (`doctors.id`). Unverified doctors return `404 Not Found` to public callers, but are accessible to the owning doctor and administrators.
- **Access**: Public (for verified doctors); Owner Doctor or Admin (for unverified)
- **Path Parameters**: `id` (positive integer representing `doctors.id`)
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "doctor": {
        "id": "1",
        "user_id": "10",
        "name": "Dr. Aarav Patel",
        "email": "dr.aarav@example.com",
        "specialization": "Kayachikitsa & Panchakarma",
        "qualification": "BAMS, MD (Ayurveda)",
        "experience_years": 14,
        "consultation_fee": "750.00",
        "verification_status": "verified",
        "bio": "Ayurvedic specialist focusing on chronic digestive wellness."
      }
    }
  }
  ```

### 3. Get Own Doctor Profile (`GET /api/doctors/profile`)
Retrieves the logged-in doctor's professional profile.
- **Access**: Doctor only (`role: doctor`)
- **Response (`200 OK`)**: Returns doctor profile object matching own credentials.

### 4. Update Own Doctor Profile (`PUT /api/doctors/profile`)
Allows an authenticated doctor to update their own clinical credentials, bio, and fee.
- **Access**: Doctor only (`role: doctor`)
- **Request Body**:
  ```json
  {
    "specialization": "Panchakarma & Gut Health",
    "qualification": "BAMS, MD (Ayurveda), Ph.D.",
    "experience_years": 15,
    "consultation_fee": 850.00,
    "bio": "Senior Ayurvedic Practitioner with extensive experience in clinical detoxification."
  }
  ```
- **Response (`200 OK`)**: Returns updated doctor profile with HTTP 200.

---

## 9. Doctor Availability Scheduling API

Endpoints under `/api/availability` manage doctor calendar slots.

### 1. Create Availability Slot (`POST /api/availability`)
Creates a new calendar slot. Enforces:
- `start_time` must be in the future.
- `start_time < end_time`.
- Slot serialization via doctor row locking (`SELECT id FROM doctors WHERE id = $1 FOR UPDATE`).
- Overlap prevention via GiST exclusion constraint (`uq_doctor_slot_no_overlap`).
- **Access**: Doctor only (`role: doctor`)
- **Request Body**:
  ```json
  {
    "start_time": "2026-11-10T10:00:00.000Z",
    "end_time": "2026-11-10T10:30:00.000Z"
  }
  ```
- **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "Availability slot created successfully",
    "data": {
      "id": "1",
      "doctor_id": "1",
      "start_time": "2026-11-10T10:00:00.000Z",
      "end_time": "2026-11-10T10:30:00.000Z",
      "status": "available",
      "created_at": "2026-10-28T01:30:00.000Z"
    }
  }
  ```

### 2. List Availability Slots (`GET /api/availability` & `GET /api/availability/doctor/:doctorId`)
Public directory to discover open slots.
- **Access**: Public / Authenticated
- **Query Parameters**:
  - `doctor_id` (or path parameter `:doctorId`): Filter by doctor profile ID.
  - `from` (optional): Slots starting on or after ISO timestamp.
  - `to` (optional): Slots ending on or before ISO timestamp.
  - `status` (optional): Defaults to `available`. Non-available slots (`booked`, `cancelled`) can only be queried by the owning doctor.
  - `limit` (optional): Integer between 1 and 100 (default `50`).
  - `offset` (optional): Integer (default `0`).
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "count": 1,
    "data": [
      {
        "id": "1",
        "doctor_id": "1",
        "start_time": "2026-11-10T10:00:00.000Z",
        "end_time": "2026-11-10T10:30:00.000Z",
        "status": "available",
        "specialization": "Kayachikitsa & Panchakarma",
        "consultation_fee": "750.00",
        "doctor_name": "Dr. Aarav Patel"
      }
    ]
  }
  ```

### 3. Get Availability Slot by ID (`GET /api/availability/:id`)
- **Access**: Public / Authenticated
- **Response (`200 OK`)**: Detailed slot metadata, fee, and doctor profile details.

### 4. Update Availability Slot (`PATCH /api/availability/:id`)
Allows a doctor to reschedule an unbooked slot. Already booked slots return `409 Conflict`.
- **Access**: Doctor only (must own the slot)
- **Request Body**:
  ```json
  {
    "start_time": "2026-11-10T11:00:00.000Z",
    "end_time": "2026-11-10T11:30:00.000Z"
  }
  ```

### 5. Delete Availability Slot (`DELETE /api/availability/:id`)
Deletes an unbooked slot. Booked slots return `409 Conflict`.
- **Access**: Doctor only (must own the slot)
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Availability slot deleted successfully"
  }
  ```

---

## 10. Consultation Booking & Idempotency API

Endpoints under `/api/consultations` handle patient bookings, cancellations, and status queries.

### Idempotency Implementation Details
To prevent duplicate consultation bookings caused by network retries or double form submissions:
1. **`Idempotency-Key` Header**: Clients can send a unique key header (e.g., `Idempotency-Key: 7b9f8e21-0a44-48f2-84f9-2c7891234567`).
2. **Payload Fingerprinting**: A deterministic SHA-256 hash is computed over the normalized payload (`availability_slot_id`, `doctor_id`, `notes`).
3. **Atomic State Tracking (`idempotency_keys` table)**:
   - When a booking transaction begins, a record with status `processing` is created.
   - If the transaction succeeds, the record is updated to `completed` along with the HTTP response code (201) and cached JSON response body.
4. **Replay Behavior**:
   - Subsequent requests with the **same key and identical payload** immediately return the cached response with HTTP 201 and the header `Idempotent-Replayed: true`.
   - Subsequent requests with the **same key but a DIFFERENT payload** are rejected with **HTTP 422 Unprocessable Entity** (`"Idempotency key reused with a different request payload"`).
   - In-flight concurrent requests with the same key receive **HTTP 409 Conflict** (`"A request with this idempotency key is currently being processed. Please retry shortly."`).
5. **Backward Compatibility**: If no `Idempotency-Key` header is provided, standard booking proceeds without idempotency caching.

### 1. Book a Consultation (`POST /api/consultations` & `POST /api/consultations/book`)
Runs inside an atomic PostgreSQL transaction:
1. Validates `Idempotency-Key` header if present.
2. Acquires row-level lock on the slot: `SELECT ... FROM availability_slots WHERE id = $1 FOR UPDATE`.
3. Verifies slot status is `available` and start time is in the future.
4. Updates slot status to `booked`.
5. Inserts consultation record with unique reference code (`CON-<timestamp>-<hex>`).
6. Enforces database partial unique index `uq_consultations_active_slot` to mathematically guarantee zero double-bookings.
7. Commits transaction and records audit log.

- **Access**: Patient only (`role: patient`, `status: active`)
- **Headers**:
  ```text
  Authorization: Bearer <patient_token>
  Idempotency-Key: 7b9f8e21-0a44-48f2-84f9-2c7891234567
  ```
- **Request Body**:
  ```json
  {
    "availability_slot_id": 1,
    "doctor_id": 1,
    "notes": "Consultation for chronic acidity and digestive issues"
  }
  ```
- **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "Consultation booked successfully",
    "data": {
      "consultation": {
        "id": "1",
        "booking_reference": "CON-1761614400000-8F3A1C",
        "patient_id": "2",
        "doctor_id": "1",
        "availability_slot_id": "1",
        "status": "booked",
        "consultation_fee": "750.00",
        "notes": "Consultation for chronic acidity and digestive issues",
        "created_at": "2026-10-28T02:00:00.000Z",
        "updated_at": "2026-10-28T02:00:00.000Z"
      }
    }
  }
  ```

### 2. List Consultations (`GET /api/consultations` & `GET /api/consultations/my`)
Retrieves consultations for the authenticated user. Patients view their own bookings; doctors view consultations assigned to them.
- **Access**: Authenticated (`patient`, `doctor`, or `admin`)
- **Query Parameters**:
  - `status` (optional): Filter by `booked`, `completed`, `cancelled`.
  - `limit` (optional): Integer (default `20`).
  - `offset` (optional): Integer (default `0`).
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "consultations": [
        {
          "id": "1",
          "booking_reference": "CON-1761614400000-8F3A1C",
          "patient_id": "2",
          "doctor_id": "1",
          "status": "booked",
          "consultation_fee": "750.00",
          "start_time": "2026-11-10T10:00:00.000Z",
          "end_time": "2026-11-10T10:30:00.000Z",
          "doctor_name": "Dr. Aarav Patel",
          "patient_name": "Sita Sharma"
        }
      ]
    }
  }
  ```

### 3. Get Consultation Details (`GET /api/consultations/:id`)
Strictly enforces ownership boundaries: patients can only access their own consultations, doctors can only access assigned consultations, and admins can access any consultation.
- **Access**: Authenticated (Patient owner, assigned Doctor, or Admin)

### 4. Cancel Consultation (`PATCH /api/consultations/:id/cancel`)
Atomically marks consultation as `cancelled` and releases the associated availability slot back to `available` within a single PostgreSQL transaction. Completed consultations cannot be cancelled (409).
- **Access**: Authenticated (Patient owner or assigned Doctor)
- **Request Body**:
  ```json
  {
    "reason": "Patient requested rescheduling due to travel"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Consultation cancelled successfully",
    "data": {
      "consultation": {
        "id": "1",
        "status": "cancelled",
        "cancellation_reason": "Patient requested rescheduling due to travel",
        "cancelled_at": "2026-10-28T02:15:00.000Z"
      }
    }
  }
  ```

---

## 11. Prescription Management API

Endpoints under `/api/prescriptions` handle clinical Ayurvedic recommendations.

### 1. Create Prescription (`POST /api/prescriptions`)
Allows assigned doctors to issue clinical advice for a consultation. Validated by Zod (`createPrescriptionSchema`). Automatically verifies that the consultation is assigned to the authenticated doctor.
- **Access**: Doctor only (must be assigned to the consultation)
- **Request Body**:
  ```json
  {
    "consultation_id": 1,
    "prescription_details": {
      "diagnosis": "Amlapitta (Hyperacidity) and Mandagni",
      "medicines": [
        {
          "name": "Avipattikar Churna",
          "dosage": "3 grams",
          "timing": "Before meals with lukewarm water",
          "duration": "14 days"
        },
        {
          "name": "Kamdudha Ras (Moti Yukta)",
          "dosage": "1 tablet (250mg)",
          "timing": "Twice daily after meals",
          "duration": "14 days"
        }
      ],
      "dietary_advice": "Avoid pungent, sour, and excessively salty food; consume pomegranate and cow ghee.",
      "lifestyle_notes": "Follow Dinacharya; maintain fixed sleep and wake timings."
    },
    "notes": "Follow-up consultation recommended in 2 weeks"
  }
  ```
- **Response (`201 Created`)**:
  ```json
  {
    "success": true,
    "message": "Prescription created successfully",
    "data": {
      "prescription": {
        "id": "1",
        "consultation_id": "1",
        "doctor_id": "1",
        "patient_id": "2",
        "prescription_details": { "...": "..." },
        "notes": "Follow-up consultation recommended in 2 weeks",
        "created_at": "2026-10-28T02:30:00.000Z"
      }
    }
  }
  ```

### 2. List Own Prescriptions (`GET /api/prescriptions/my`)
Retrieves prescriptions issued to the logged-in patient or written by the logged-in doctor.
- **Access**: Authenticated (`patient` or `doctor`)

### 3. Get Prescription Details (`GET /api/prescriptions/:id`)
Enforces privacy boundaries: only the receiving patient, issuing doctor, or administrator can view the prescription (403 for unauthorized users).
- **Access**: Receiving Patient, Issuing Doctor, or Admin

---

## 12. Payment Billing Records API

Endpoints under `/api/payments` provide internal billing ledger management.

### Payment Behavior & Scope Notice
- **Internal Billing Records**: Payments represent internal billing ledger entries in PostgreSQL (`payments` table).
- **No External Gateway**: No third-party gateway SDK (e.g., Stripe, Razorpay) or external webhook signature verification is integrated, fully aligning with assignment specifications.
- **No Request Idempotency Header**: The consultation `Idempotency-Key` header mechanism applies specifically to consultation booking, not to payment recording.
- **Duplicate Prevention**: If a consultation is already marked as `status: 'completed'`, subsequent payment attempts are rejected with **HTTP 409 Conflict** (`"This consultation is already paid"`).

### 1. Record Consultation Payment (`POST /api/payments`)
Records or updates the payment state for a booked consultation.
- **Access**: Patient owner (or Admin)
- **Request Body**:
  ```json
  {
    "consultation_id": 1,
    "amount": 750.00,
    "currency": "INR",
    "status": "completed",
    "provider_reference": "UPI-REF-20261028-98421"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Payment record processed successfully",
    "data": {
      "payment": {
        "id": "1",
        "consultation_id": "1",
        "amount": "750.00",
        "currency": "INR",
        "status": "completed",
        "provider_reference": "UPI-REF-20261028-98421",
        "created_at": "2026-10-28T02:45:00.000Z"
      }
    }
  }
  ```

### 2. Get Payment by Consultation (`GET /api/payments/consultation/:consultationId`)
Retrieves the payment ledger entry for a specific consultation.
- **Access**: Patient owner, assigned Doctor, or Admin

---

## 13. Admin Management & Analytics API

Endpoints under `/api/admin` provide administrative oversight. Restricted strictly to `role: 'admin'`.

### 1. System Analytics & Metrics (`GET /api/admin/metrics`)
Aggregates platform statistics in a single optimized database query.
- **Access**: Admin only (`role: admin`)
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "metrics": {
        "total_users": "24",
        "active_users": "22",
        "total_patients": "15",
        "total_doctors": "8",
        "verified_doctors": "6",
        "pending_doctors": "2",
        "total_consultations": "42",
        "completed_consultations": "30",
        "total_revenue": "22500.00"
      }
    }
  }
  ```

### 2. List Pending Doctor Verifications (`GET /api/admin/doctors/pending`)
Returns all doctor accounts currently in `pending` verification status.
- **Access**: Admin only (`role: admin`)
- **Response (`200 OK`)**: Returns array of pending doctor profiles with their qualifications and contact details.

### 3. Verify or Reject Doctor (`PATCH /api/admin/doctors/:id/verify`)
Updates a doctor's verification status. Note: `:id` in the URL path is `doctors.id` (positive integer).
- **Access**: Admin only (`role: admin`)
- **Request Body**:
  ```json
  {
    "status": "verified"
  }
  ```
- **Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "message": "Doctor status updated to verified successfully",
    "data": {
      "doctor": {
        "id": "1",
        "user_id": "10",
        "name": "Dr. Aarav Patel",
        "verification_status": "verified",
        "is_verified": true
      }
    }
  }
  ```

---

## 14. Observability, Logging & Health Probes

### 14.1 Health Probes
Configured for application runtime and health check monitoring. Probes are excluded from HTTP logging to prevent log pollution.

| Probe | Endpoint | Method | Success Response | Failure Response |
|---|---|---|---|---|
| **Liveness** | `/health/live` | `GET` | `200 OK` (`{"status":"UP","uptime":120}`) | Process failure |
| **Readiness** | `/health/ready` | `GET` | `200 OK` (`{"status":"UP","database":"connected"}`) | `503 Service Unavailable` (`{"status":"DOWN"}`) |

### 14.2 Request Correlation (`X-Request-Id`)
Implemented in `src/middleware/requestId.middleware.js`:
- Inspects incoming `X-Request-Id` HTTP header. If provided and valid (alphanumeric/hyphen/underscore, max 100 chars), preserves it.
- If missing or invalid, generates a UUIDv4 via `crypto.randomUUID()`.
- Sets `X-Request-Id` on the outgoing response header and binds `req.id` to all logs and database audit entries.

### 14.3 Structured Logging (Pino)
- Powered by `pino` (v10) and `pino-http` (v11).
- Outputs machine-readable JSON with log levels (`info`, `warn`, `error`).
- Automatically serializes request method, URL, status code, and response time in milliseconds.

### 14.4 Database Audit Trail (`audit_logs`)
- Records security-sensitive operations: user registration, logins, token rotation, slot creation, consultation bookings, cancellations, and doctor verifications.
- Automatically redacts passwords, tokens, cookies, and secret keys before storing JSONB metadata.

---

## 15. Automated Testing & CI Pipeline

The backend includes a comprehensive automated test suite powered by **Jest** and **Supertest**. Tests run against a live PostgreSQL database to validate transactions, constraints, and race conditions.

### Test Command
```bash
npm test
```
*(Executes `jest --passWithNoTests --runInBand --forceExit`)*

### Verified Test Suite Results

```text
Test Suites: 11 passed, 11 total
Tests:       167 passed, 167 total
Snapshots:   0 total
Time:        11.476 s
```

### Breakdown of Test Suites (167 Tests Total)

| Test Suite | Path | Tests | Verified Functional Scope |
|---|---|---|---|
| **Booking & Concurrency** | `tests/api/booking.test.js` | **75** | Slot creation, overlap exclusion, `SELECT ... FOR UPDATE` locking, race condition prevention, cancellation release, ownership boundaries, and fee matching. |
| **Profile Management** | `tests/api/profile.test.js` | **22** | Patient profile retrieval & updates, partial update preservation, protected field immutability, doctor profile updates, and unverified doctor visibility rules. |
| **Authentication** | `tests/api/auth.test.js` | **22** | User registration, password hashing, duplicate email rejection, role validation, login, cookie setting, session termination, and `/me` retrieval. |
| **Token Rotation** | `tests/api/refreshToken.test.js` | **12** | SHA-256 token hashing, atomic rotation, token family tracking, automatic reuse detection, family revocation, and expired token rejection. |
| **Admin Operations** | `tests/api/admin.test.js` | **10** | Metrics calculation, pending doctor listing, doctor verification (`doctors.id`), role guards (403), and unauthenticated rejection (401). |
| **Request Idempotency** | `tests/api/idempotency.test.js` | **9** | `Idempotency-Key` header validation, response caching, `Idempotent-Replayed: true` replay, 422 payload mismatch, 409 in-flight conflict, and backward compatibility. |
| **Audit Logging** | `tests/api/audit.test.js` | **6** | Audit trail persistence, sensitive credential redaction, non-transactional logging resilience, and request correlation tracking. |
| **Rate Limiting** | `tests/api/rateLimit.test.js` | **5** | In-memory sliding-window limiters, endpoint-specific thresholds, standard headers (`RateLimit-*`), and HTTP 429 JSON responses. |
| **Database Pool** | `tests/unit/db.test.js` | **3** | PostgreSQL connection pool initialization, query execution, and graceful pool shutdown. |
| **Health Probes** | `tests/api/health.test.js` | **2** | `/health/live` uptime check and `/health/ready` database connectivity verification. |
| **Route Scaffolding** | `tests/integration/routeScaffold.test.js` | **1** | Express middleware order, route registration, and 404 handler for undefined endpoints. |

### Continuous Integration (GitHub Actions)
The repository includes `.github/workflows/ci.yml` which executes on every push and pull request to `main`, `master`, and `develop`:
- Matrix strategy testing on **Node.js 20.x** and **Node.js 22.x**.
- Automatically provisions a dedicated PostgreSQL 17 test service within the GitHub Actions runner.
- Executes `npm ci`, applies database migrations (`npm run db:migrate`), and runs the full automated test suite (`npm test`).
- Reviewers do not need Docker locally; the CI pipeline is entirely self-contained on GitHub.

---

## 16. Security & Concurrency Protections

### 1. In-Memory Rate Limiting
Configured using `express-rate-limit` with standalone in-memory counters (no Redis required for standalone operation):
- Global API limiter: 200 requests / 15 minutes.
- Login limiter: 10 attempts / 15 minutes.
- Signup limiter: 10 attempts / 15 minutes.
- Refresh limiter: 30 requests / 15 minutes.
- Password reset limiter: 5 requests / 15 minutes.
- Returns standard HTTP 429 with `Retry-After` header.

### 2. Transactional Concurrency Protection
- **Doctor Availability**: Uses doctor row-level locking during slot creation (`SELECT id FROM doctors WHERE id = $1 FOR UPDATE`) combined with PostgreSQL GiST exclusion constraint (`uq_doctor_slot_no_overlap`).
- **Consultation Booking**: Locks availability slot (`SELECT ... FOR UPDATE`), marks slot `booked`, inserts consultation, and relies on partial unique index `uq_consultations_active_slot` to guarantee zero double bookings.
- **Cancellation**: Releases slot to `available` within the same transaction as marking the consultation `cancelled`.

### 3. Parameterized SQL (Zero SQL Injection)
All database interactions in `src/query/` use parameterized SQL statements (`$1, $2, ...`) executed via `pg.Pool`. No user input is ever concatenated into SQL query strings.

### 4. Credential Sanitization
- Passwords hashed with `bcryptjs` (salt rounds = 10).
- Refresh tokens hashed with SHA-256 before storage in PostgreSQL.
- Audit logs automatically redact sensitive fields (`password`, `token`, `secret`, `authorization`, `cookie`).
- Error handler masks internal PostgreSQL error details in production environments.

---

## License

This project is licensed under the **ISC License**. Developed for the Amrutam Telemedicine Backend Engineering Assessment.
