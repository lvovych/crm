-- CreateTable
CREATE TABLE "supplier_term_changes" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "previous" DATE,
    "due" DATE NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT NOT NULL,

    CONSTRAINT "supplier_term_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_term_changes_entryId_changedAt_idx" ON "supplier_term_changes"("entryId", "changedAt");

-- AddForeignKey
ALTER TABLE "supplier_term_changes" ADD CONSTRAINT "supplier_term_changes_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "supplier_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

