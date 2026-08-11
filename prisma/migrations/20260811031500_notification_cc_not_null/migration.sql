-- `cc` was added as a bare TEXT[], which leaves every pre-existing NotificationLog row NULL.
-- The client types the field as String[] and /dashboard/outbox reads `log.cc.length`, so a NULL
-- there is a crashed audit page rather than a missing value. Backfill, then make it impossible.
UPDATE "NotificationLog" SET "cc" = ARRAY[]::TEXT[] WHERE "cc" IS NULL;

ALTER TABLE "NotificationLog" ALTER COLUMN "cc" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "NotificationLog" ALTER COLUMN "cc" SET NOT NULL;
