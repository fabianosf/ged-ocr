#!/bin/sh
set -eu

umask 077
backup_dir=${BACKUP_DIR:-./backups}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
database_backup="$backup_dir/ged-ocr-db-$timestamp.dump"
media_backup="$backup_dir/ged-ocr-media-$timestamp.tar.gz"
database_tmp="$database_backup.tmp"
media_tmp="$media_backup.tmp"

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
if [ -e "$database_backup" ] || [ -e "$media_backup" ]; then
  echo "Já existe um backup com este identificador de horário." >&2
  exit 1
fi

for service in backend worker frontend; do
  if docker compose ps --services --status running | grep -Fxq "$service"; then
    echo "Pare backend, worker e frontend antes do backup para manter banco e fotos consistentes." >&2
    exit 1
  fi
done

trap 'rm -f -- "$database_tmp" "$media_tmp"' EXIT HUP INT TERM

docker compose exec -T db sh -c \
  'pg_dump --format=custom --no-owner --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  > "$database_tmp"
docker compose run --rm --no-deps backend sh -c 'tar -C /app -czf - media' > "$media_tmp"

mv "$database_tmp" "$database_backup"
mv "$media_tmp" "$media_backup"

find "$backup_dir" -maxdepth 1 -type f \
  \( -name 'ged-ocr-db-*.dump' -o -name 'ged-ocr-media-*.tar.gz' \) \
  -mmin +43200 -delete

printf 'Backup concluído:\n%s\n%s\n' "$database_backup" "$media_backup"
