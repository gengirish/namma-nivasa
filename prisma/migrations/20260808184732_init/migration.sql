-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'CURATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Amenity" AS ENUM ('GYM', 'SECURITY', 'LIFT', 'PARKING', 'POWER', 'GARDEN', 'POOL', 'STUDY');

-- CreateEnum
CREATE TYPE "HoodKind" AS ENUM ('TRANSIT', 'WORK', 'SCHOOL', 'HEALTH', 'SHOPPING', 'DINING', 'PARK');

-- CreateEnum
CREATE TYPE "EnquiryKind" AS ENUM ('SITE_VISIT', 'OWNER_CALL', 'MESSAGE', 'GENERAL');

-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'SCHEDULED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ViewingStatus" AS ENUM ('BOOKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('NEW', 'REVIEWING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ENQUIRY_RECEIVED', 'VIEWING_BOOKED', 'OWNER_SUBMISSION_RECEIVED', 'NEWSLETTER_WELCOME');

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "AdminRole" NOT NULL DEFAULT 'CURATOR',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "locality" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "story" TEXT NOT NULL,
    "description" TEXT[],
    "bhk" TEXT NOT NULL,
    "bhkNum" INTEGER NOT NULL,
    "areaLabel" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "areaSqft" INTEGER NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "amenities" "Amenity"[],
    "hoodBlurb" TEXT NOT NULL,
    "heroImageUrl" TEXT NOT NULL,
    "videoUrl" TEXT,
    "floorplanUrl" TEXT,
    "floorplanNote" TEXT,
    "weeklyViewingSlots" INTEGER NOT NULL DEFAULT 3,
    "publishedAt" TIMESTAMPTZ(3),
    "publishedBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyImage" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoodPlace" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" "HoodKind" NOT NULL,
    "name" TEXT NOT NULL,
    "distance" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HoodPlace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "EnquiryKind" NOT NULL,
    "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "propertyId" TEXT,
    "propertyName" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "message" TEXT,
    "handledBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Viewing" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMPTZ(3) NOT NULL,
    "status" "ViewingStatus" NOT NULL DEFAULT 'BOOKED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Viewing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerSubmission" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'NEW',
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "locality" TEXT NOT NULL,
    "propertyType" TEXT,
    "config" TEXT,
    "areaSqft" INTEGER,
    "expectedPrice" TEXT,
    "timeline" TEXT,
    "message" TEXT,
    "mediaCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OwnerSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "unsubscribedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "type" "NotificationType" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "error" TEXT,
    "subjectId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_clerkUserId_key" ON "Admin"("clerkUserId");

-- CreateIndex
CREATE INDEX "Admin_role_idx" ON "Admin"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Property_slug_key" ON "Property"("slug");

-- CreateIndex
CREATE INDEX "Property_status_publishedAt_idx" ON "Property"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "Property_bhkNum_idx" ON "Property"("bhkNum");

-- CreateIndex
CREATE INDEX "PropertyImage_propertyId_sortOrder_idx" ON "PropertyImage"("propertyId", "sortOrder");

-- CreateIndex
CREATE INDEX "HoodPlace_propertyId_sortOrder_idx" ON "HoodPlace"("propertyId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_reference_key" ON "Enquiry"("reference");

-- CreateIndex
CREATE INDEX "Enquiry_status_createdAt_idx" ON "Enquiry"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Enquiry_propertyId_createdAt_idx" ON "Enquiry"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "Enquiry_phone_idx" ON "Enquiry"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Viewing_enquiryId_key" ON "Viewing"("enquiryId");

-- CreateIndex
CREATE INDEX "Viewing_propertyId_scheduledFor_status_idx" ON "Viewing"("propertyId", "scheduledFor", "status");

-- CreateIndex
CREATE INDEX "Viewing_scheduledFor_idx" ON "Viewing"("scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "Viewing_propertyId_scheduledFor_key" ON "Viewing"("propertyId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerSubmission_reference_key" ON "OwnerSubmission"("reference");

-- CreateIndex
CREATE INDEX "OwnerSubmission_status_createdAt_idx" ON "OwnerSubmission"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_email_key" ON "Subscriber"("email");

-- CreateIndex
CREATE INDEX "Subscriber_createdAt_idx" ON "Subscriber"("createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_status_createdAt_idx" ON "NotificationLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_subjectId_idx" ON "NotificationLog"("subjectId");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_publishedBy_fkey" FOREIGN KEY ("publishedBy") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyImage" ADD CONSTRAINT "PropertyImage_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoodPlace" ADD CONSTRAINT "HoodPlace_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_handledBy_fkey" FOREIGN KEY ("handledBy") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Viewing" ADD CONSTRAINT "Viewing_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Viewing" ADD CONSTRAINT "Viewing_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
