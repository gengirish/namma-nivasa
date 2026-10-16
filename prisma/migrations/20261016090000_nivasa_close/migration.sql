-- CreateEnum
CREATE TYPE "DealPlaybook" AS ENUM ('BUILDER_ASSIGNMENT', 'REGISTERED_RESALE');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('DRAFT', 'ACTIVE', 'AT_RISK', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DealPartyRole" AS ENUM ('SELLER', 'BUYER', 'SELLER_BANK', 'BUYER_BANK', 'BUILDER', 'ASSOCIATION', 'OTHER');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DealDocumentKind" AS ENUM ('MOU', 'LOU', 'BANK_NOC_LOD_REQUEST', 'BANK_FORECLOSURE_REQUEST', 'BANK_FOLLOW_UP');

-- CreateEnum
CREATE TYPE "DealPaymentKind" AS ENUM ('TOKEN', 'BOOKING', 'SELF_FUNDING', 'LOAN_DISBURSAL', 'SELLER_LOAN_PAYOFF', 'TDS', 'BALANCE', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'DEAL_MILESTONE_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'DEAL_AT_RISK';
ALTER TYPE "NotificationType" ADD VALUE 'DEAL_PARTY_UPDATE';

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "playbook" "DealPlaybook" NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'DRAFT',
    "propertyId" TEXT,
    "enquiryId" TEXT,
    "propertyLabel" TEXT NOT NULL,
    "considerationPaise" BIGINT NOT NULL,
    "sheet" JSONB NOT NULL,
    "mouSignedAt" TIMESTAMPTZ(3),
    "deadlineAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "handledBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealParty" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "role" "DealPartyRole" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "shareBps" INTEGER,
    "panLast4" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DealParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealMilestone" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ownerRole" "DealPartyRole" NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMPTZ(3),
    "doneAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "lastNotifiedAt" TIMESTAMPTZ(3),

    CONSTRAINT "DealMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealDocument" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" "DealDocumentKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "html" TEXT NOT NULL,
    "sheetHash" TEXT NOT NULL,
    "final" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealPayment" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" "DealPaymentKind" NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "fromLabel" TEXT NOT NULL,
    "toLabel" TEXT NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "txnRef" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deal_reference_key" ON "Deal"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_enquiryId_key" ON "Deal"("enquiryId");

-- CreateIndex
CREATE INDEX "Deal_status_deadlineAt_idx" ON "Deal"("status", "deadlineAt");

-- CreateIndex
CREATE INDEX "DealParty_dealId_role_idx" ON "DealParty"("dealId", "role");

-- CreateIndex
CREATE INDEX "DealMilestone_status_dueAt_idx" ON "DealMilestone"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "DealMilestone_dealId_key_key" ON "DealMilestone"("dealId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "DealDocument_dealId_kind_version_key" ON "DealDocument"("dealId", "kind", "version");

-- CreateIndex
CREATE INDEX "DealPayment_dealId_kind_idx" ON "DealPayment"("dealId", "kind");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_handledBy_fkey" FOREIGN KEY ("handledBy") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParty" ADD CONSTRAINT "DealParty_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealMilestone" ADD CONSTRAINT "DealMilestone_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDocument" ADD CONSTRAINT "DealDocument_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealPayment" ADD CONSTRAINT "DealPayment_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

