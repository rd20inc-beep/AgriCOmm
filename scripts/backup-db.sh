#!/bin/bash
# RiceFlow ERP — Database Backup Script
# Usage: ./scripts/backup-db.sh [output_dir]
# Can be added to crontab: 0 2 * * * /path/to/backup-db.sh /path/to/backups

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_CONTAINER="${DB_CONTAINER:-riceflow-db}"
DB_NAME="${DB_NAME:-riceflow_erp}"
DB_USER="${DB_USER:-riceflow}"
BACKUP_FILE="${BACKUP_DIR}/riceflow_${TIMESTAMP}.sql.gz"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"

echo "Starting backup of ${DB_NAME}..."

# Dump via Docker container, compress with gzip
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"

# Verify backup was created and is non-empty
if [ -s "$BACKUP_FILE" ]; then
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "Backup successful: $BACKUP_FILE ($SIZE)"
else
    echo "ERROR: Backup file is empty or was not created" >&2
    rm -f "$BACKUP_FILE"
    exit 1
fi

# Clean up old backups
find "$BACKUP_DIR" -name "riceflow_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
echo "Cleaned up backups older than ${RETENTION_DAYS} days"
