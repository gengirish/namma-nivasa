-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "privateNote" TEXT;

-- AlterTable
ALTER TABLE "OwnerSubmission" ADD COLUMN     "propertyId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OwnerSubmission_propertyId_key" ON "OwnerSubmission"("propertyId");

-- AddForeignKey
ALTER TABLE "OwnerSubmission" ADD CONSTRAINT "OwnerSubmission_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
