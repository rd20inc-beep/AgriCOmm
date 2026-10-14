# Runbook: redact secrets in historic audit_logs rows (P1-01 / ADM-01)

New audit rows are redacted at write time (`backend/src/utils/redactSecrets.js`) and every
audit reader redacts on the way out. Rows written **before** that fix can still hold plaintext
passwords / PINs / API keys inside `audit_logs.details` (mostly `details.body` of `create_user`,
`update_user` and `settings` rows). This runbook rewrites those values to `"[REDACTED]"` in place.
No row is deleted.

Needs owner approval (decision D-26). Never paste query output that contains values into chat,
tickets or reports — the queries below return **counts only**.

## 1. Count before (read-only)

```sql
-- rows whose details mention a secret-looking key (rough, counts only)
SELECT entity_type, count(*)
FROM audit_logs
WHERE details::text ~* '"(password|new_password|current_password|pin|portal_pin|[a-z_]*api_key|secret|token|auth_credentials|smtp_pass)"\s*:\s*"[^"[]'
GROUP BY entity_type ORDER BY 2 DESC;
```

Exact count with the same matcher the code uses:

```bash
docker exec -it riceflow-backend node scripts/redactAuditSecrets.js --dry-run
```

## 2. Backup

```bash
docker exec riceflow-db pg_dump -U riceflow -d riceflow_erp -t audit_logs -Fc \
  -f /tmp/audit_logs_before_redaction_$(date +%F).dump
docker cp riceflow-db:/tmp/audit_logs_before_redaction_$(date +%F).dump ./backups/
```

The dump itself holds the secrets: store it like a credential (owner-only), and delete it once
the redaction is verified and the affected passwords/keys have been rotated (D-27).

## 3. Redact

```bash
docker exec -it -e REDACT_AUDIT_SECRETS=1 riceflow-backend node scripts/redactAuditSecrets.js
```

Without `REDACT_AUDIT_SECRETS=1` (and without `--dry-run`) the script refuses and exits 2.
It processes rows in batches of 500, one transaction per batch, and is idempotent — re-running
finds 0 rows.

## 4. Count after

Re-run the SQL in step 1 (expect 0 rows) and:

```bash
docker exec -it riceflow-backend node scripts/redactAuditSecrets.js --dry-run   # expect 0
```

Also confirm the row total is unchanged (`SELECT count(*) FROM audit_logs;` before vs after).

## 5. Rollback

`pg_restore --data-only` of the dump into a scratch table and copy back `details` by id —
only if the redaction touched something it should not have. Rotating the exposed credentials
is the real remediation; the redaction only stops further reads.
