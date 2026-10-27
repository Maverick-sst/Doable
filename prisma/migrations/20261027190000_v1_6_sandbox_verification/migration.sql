-- D8/D9: real sandbox verification evidence and bounded repair lineage.

ALTER TABLE "VerificationReport"
  ADD COLUMN "snapshotHash" TEXT,
  ADD COLUMN "previewUrl" TEXT,
  ADD COLUMN "steps" JSONB,
  ADD COLUMN "evidence" JSONB,
  ADD COLUMN "parentReportId" TEXT,
  ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "VerificationReport_parentReportId_idx"
  ON "VerificationReport"("parentReportId");

ALTER TABLE "VerificationReport"
  ADD CONSTRAINT "VerificationReport_parentReportId_fkey"
  FOREIGN KEY ("parentReportId") REFERENCES "VerificationReport"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
