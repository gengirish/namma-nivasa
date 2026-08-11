-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'VIEWING_REMINDER';

-- AlterTable
ALTER TABLE "NotificationLog" ALTER COLUMN "cc" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Viewing" ADD COLUMN     "reminderSentAt" TIMESTAMPTZ(3);
