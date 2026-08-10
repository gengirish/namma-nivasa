-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "EmailThreadStatus" AS ENUM ('OPEN', 'AWAITING_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "AgentDraftStatus" AS ENUM ('PENDING_REVIEW', 'AUTO_SENT', 'SENT', 'DISMISSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReplyIntent" AS ENUM ('VIEWING_RESCHEDULE', 'VIEWING_CANCEL', 'VIEWING_CONFIRM', 'LOGISTICS', 'PROPERTY_QUESTION', 'PRICE_NEGOTIATION', 'DOCUMENTS', 'OTHER', 'UNCLEAR');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'AGENT_REPLY_PENDING';

-- CreateTable
CREATE TABLE "EmailThread" (
    "id" TEXT NOT NULL,
    "providerThreadId" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "participantEmail" TEXT NOT NULL,
    "subject" TEXT,
    "status" "EmailThreadStatus" NOT NULL DEFAULT 'OPEN',
    "enquiryId" TEXT,
    "lastMessageAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" "EmailDirection" NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "toAddresses" TEXT[],
    "subject" TEXT,
    "text" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDraft" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "inReplyToId" TEXT NOT NULL,
    "intent" "ReplyIntent" NOT NULL,
    "confidence" INTEGER NOT NULL,
    "status" "AgentDraftStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "sentMessageId" TEXT,
    "reviewedBy" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "sentAt" TIMESTAMPTZ(3),

    CONSTRAINT "AgentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailThread_providerThreadId_key" ON "EmailThread"("providerThreadId");

-- CreateIndex
CREATE INDEX "EmailThread_status_lastMessageAt_idx" ON "EmailThread"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "EmailThread_participantEmail_idx" ON "EmailThread"("participantEmail");

-- CreateIndex
CREATE INDEX "EmailThread_enquiryId_idx" ON "EmailThread"("enquiryId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_providerMessageId_key" ON "EmailMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "EmailMessage_threadId_receivedAt_idx" ON "EmailMessage"("threadId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDraft_inReplyToId_key" ON "AgentDraft"("inReplyToId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDraft_sentMessageId_key" ON "AgentDraft"("sentMessageId");

-- CreateIndex
CREATE INDEX "AgentDraft_status_createdAt_idx" ON "AgentDraft"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentDraft_threadId_idx" ON "AgentDraft"("threadId");

-- AddForeignKey
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDraft" ADD CONSTRAINT "AgentDraft_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDraft" ADD CONSTRAINT "AgentDraft_inReplyToId_fkey" FOREIGN KEY ("inReplyToId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDraft" ADD CONSTRAINT "AgentDraft_sentMessageId_fkey" FOREIGN KEY ("sentMessageId") REFERENCES "EmailMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDraft" ADD CONSTRAINT "AgentDraft_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
