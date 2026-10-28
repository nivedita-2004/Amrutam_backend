# Threat Model - Amrutam Telemedicine Backend

This threat model outlines the primary assets, potential threat vectors, and technical countermeasures implemented in the Amrutam Telemedicine system based on the STRIDE framework.

## 1. Protected Assets
- **Protected Health Information (PHI)**: Patient medical history, doctor consultation notes, prescription details.
- **Personally Identifiable Information (PII)**: User names, email addresses, phone numbers, addresses, birth dates.
- **Financial Records**: Payment amounts, transaction status, provider references.
- **Authentication Credentials**: Password hashes, session refresh tokens.
- **Audit Logs**: Immutable traces of user actions and security events.

## 2. Threat Analysis (STRIDE)

| Threat Category | Potential Risk Scenario | Technical Countermeasures |
| :--- | :--- | :--- |
| **Spoofing** | Attacker impersonating doctor or patient to access medical consultations | - Cryptographic password hashing (bcrypt).<br>- Token-based authentication with expiration.<br>- Audit logging of all access tokens and logins. |
| **Tampering** | Modifying appointment status, fees, or prescription contents | - Role-Based Access Control (RBAC) ensuring only assigned doctors write prescriptions.<br>- Server-side fee verification rather than trusting client requests.<br>- Database CHECK constraints enforcing valid status transitions. |
| **Repudiation** | Doctor or patient denying consultation attendance or fee payment | - Immutable `audit_logs` capturing actor ID, timestamp, entity ID, and request ID.<br>- Distinct timestamps for consultation start and end. |
| **Information Disclosure** | Leakage of medical notes, database connection strings, or system stack traces | - Parameterized SQL preventing SQL injection.<br>- Centralized error handler redacting internal traces in production.<br>- Structured logging redacting passwords, auth headers, and PHI. |
| **Denial of Service** | Flooding appointment creation or login endpoints with automated bots | - IP and client rate limiting on public endpoints.<br>- Connection pool limits (`DB_POOL_MAX`) with timeouts.<br>- Request body size constraints (1MB max payload). |
| **Elevation of Privilege** | Normal patient calling admin or doctor verification endpoints | - `role.middleware` enforcing strict RBAC checks before controller execution.<br>- Database constraints validating role types. |

## 3. Concurrency & Race Conditions
- **Double-Booking Vulnerability**: Multiple concurrent booking attempts for the same doctor slot.
  - *Countermeasure*: Transactional row-level lock (`SELECT ... FOR UPDATE`) and a database partial unique index (`uq_appointments_active_slot`) on `availability_slot_id` WHERE `status NOT IN ('cancelled')`.
- **Payment Duplication**: Rapid double-submissions by users.
  - *Countermeasure*: Idempotency keys required on mutating financial operations stored in `idempotency_keys` table.
