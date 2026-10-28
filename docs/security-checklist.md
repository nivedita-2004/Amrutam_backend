# Security Checklist - Production Readiness

This checklist establishes mandatory controls to be maintained across all development phases of the Amrutam Telemedicine Backend.

## 1. Authentication & Session Management
- [x] Passwords must never be stored in plaintext (enforced in schema and auth logic).
- [x] Passwords and tokens excluded from logging serializers (`logger.js`).
- [ ] Implement bcrypt hashing with salt rounds >= 10 in registration and login flows.
- [ ] Enforce short-lived JWT access tokens (e.g. 15 minutes) and rotating refresh tokens.
- [x] Invalidate refresh tokens upon logout or password reset (`refresh_tokens` table created).

## 2. Authorization & Data Access
- [x] Enforce Role-Based Access Control (RBAC) via `role.middleware.js`.
- [x] Isolate patient and doctor records so users cannot inspect medical details of others.
- [x] Protect admin endpoints behind `role === 'admin'` checks.

## 3. Database & SQL Security
- [x] 100% parameterized SQL queries via `pg` parameter binding (`$1`, `$2`); zero string concatenation.
- [x] Connection strings and passwords must never be committed to git (`.gitignore` configured).
- [x] Connection error messages sanitized so DB credentials are never sent to HTTP clients.
- [x] Transactional isolation used for multi-step state mutations (booking, payments).
- [x] Advisory locks applied during database migrations to prevent race conditions.

## 4. HTTP & Transport Security
- [x] Helmet middleware enabled for standard security headers (CSP, HSTS, X-Frame-Options).
- [x] CORS configured with strict allowed methods and headers.
- [x] Rate limiting active to mitigate brute force attacks and DoS.
- [x] Request payload limits set to 1MB to prevent memory exhaustion attacks.
- [x] Unique `X-Request-Id` assigned to every request for audit tracing.

## 5. Medical Data Privacy (HIPAA / DISHA Alignment)
- [x] Audit logs record all administrative, doctor, and patient modifications (`audit_logs` table).
- [x] Sensitive medical records stored in structured JSONB columns with restricted access policies.
- [x] Idempotency keys used for payment and appointment mutations to avoid duplicate financial transactions.
