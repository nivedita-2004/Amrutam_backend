# Database Backup and Disaster Recovery Plan

This document describes the operational procedures for backing up and restoring the PostgreSQL 18 database `amrutam_db`.

## 1. Backup Strategy Overview
In healthcare applications, data loss is intolerable. The backup strategy consists of two complementary layers:
1. **Daily Logical Backups (`pg_dump`)**: For point-in-time table exports and migration verification.
2. **Continuous Archiving / Write-Ahead Logging (WAL)**: For Point-In-Time Recovery (PITR) up to the exact minute of failure.

## 2. Manual Backup via `pg_dump`
To create a consistent, compressed backup of `amrutam_db`:

```bash
# On Windows PowerShell:
$TIMESTAMP = Get-Date -Format "yyyyMMdd_HHmmss"
pg_dump -U postgres -h localhost -p 5432 -F c -b -v -f "amrutam_backup_$TIMESTAMP.dump" amrutam_db
```

Parameters explained:
- `-F c`: Custom format (compressed, supports selective restoration and parallel restore).
- `-b`: Include large objects.
- `-v`: Verbose mode.

## 3. Database Restoration Procedure
In the event of database corruption or hardware failure:

### Step 1: Create or Reset Target Database
```sql
-- Via pgAdmin 4 or psql:
DROP DATABASE IF EXISTS amrutam_db;
CREATE DATABASE amrutam_db;
```

### Step 2: Restore from Dump File
```bash
pg_restore -U postgres -h localhost -p 5432 -d amrutam_db -v "amrutam_backup_YYYYMMDD_HHMMSS.dump"
```

### Step 3: Run Pending Migrations
Ensure any migrations committed after the backup was generated are applied:
```bash
npm run db:migrate
```

## 4. Migration Rollback Policy
- Migrations in `database/migrations/` are forward-only and version-controlled.
- If a schema defect is detected, never edit or delete an already applied migration. Instead, create a new numbered migration file (e.g., `006_revert_feature_x.sql`) that safely applies compensating alterations.
- All migrations are tracked in the `schema_migrations` table.
