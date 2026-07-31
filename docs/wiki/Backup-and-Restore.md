# Backup and Restore

There is no in-app backup feature in this version (unlike `fondwaypoints`,
which has a dedicated Admin > Scheduled Backups screen) — back up the
database directly instead:

## Backing up

```
docker compose exec mongo mongodump --db balancedwaypoints --archive=/data/db/backup.archive
docker cp $(docker compose ps -q mongo):/data/db/backup.archive ./balancedwaypoints-backup.archive
```

(If using an external MongoDB instead of the bundled container, run
`mongodump` against it directly the same way you would for any other
database.)

## Restoring

```
docker cp ./balancedwaypoints-backup.archive $(docker compose ps -q mongo):/data/db/backup.archive
docker compose exec mongo mongorestore --db balancedwaypoints --archive=/data/db/backup.archive --drop
```
