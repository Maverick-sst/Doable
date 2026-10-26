-- V1.1 foundation: artifact revision consistency, idempotency keys,
-- workspace metadata, verification reports, and terminal-state support.
--
-- Preflight: refuse to add uniqueness that existing duplicate data would
-- violate. This keeps the migration safe and makes the repair obvious.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Artifact"
    WHERE "nodeId" IS NOT NULL
    GROUP BY "nodeId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate Artifact.nodeId rows exist. Deduplicate before applying 20261026110000_v11_foundation.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Artifact"
    GROUP BY "projectId", "type", "version"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate (projectId, type, version) artifacts exist. Reconcile revisions before applying 20261026110000_v11_foundation.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Node"
    GROUP BY "executionId", "order", "type"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate (executionId, order, type) nodes exist. Reconcile the graph before applying 20261026110000_v11_foundation.';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_RUN', 'RUNNING', 'PASSED', 'FAILED', 'TIMED_OUT', 'BLOCKED');

-- AlterEnum
ALTER TYPE "WorkflowType" ADD VALUE 'VERIFICATION';
ALTER TYPE "WorkflowType" ADD VALUE 'REPAIR';

-- AlterEnum
ALTER TYPE "ArtifactType" ADD VALUE 'VERIFICATION_REPORT';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "executionId" TEXT,
ADD COLUMN "workflowId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "failureReason" TEXT,
ADD COLUMN "workspacePath" TEXT,
ALTER COLUMN "status" SET DEFAULT 'DISCOVERY';

-- AlterTable
ALTER TABLE "File" ADD COLUMN "checksum" TEXT,
ADD COLUMN "mimeType" TEXT,
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "size" INTEGER;

-- AlterTable
ALTER TABLE "Execution" ADD COLUMN "failureReason" TEXT,
ADD COLUMN "finishedAt" TIMESTAMP(3),
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "temporalRunId" TEXT,
ADD COLUMN "temporalWorkflowId" TEXT;

-- AlterTable
ALTER TABLE "Node" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "failureReason" TEXT,
ADD COLUMN "finishedAt" TIMESTAMP(3),
ADD COLUMN "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Artifact" ADD COLUMN "contentHash" TEXT,
ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "validationStatus" TEXT NOT NULL DEFAULT 'VALID';

-- CreateTable
CREATE TABLE "VerificationReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "executionId" TEXT,
    "nodeId" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'NOT_RUN',
    "command" TEXT,
    "exitCode" INTEGER,
    "durationMs" INTEGER,
    "output" TEXT,
    "revision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationReport_projectId_createdAt_idx" ON "VerificationReport"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_projectId_phase_createdAt_idx" ON "Message"("projectId", "phase", "createdAt");

-- CreateIndex
CREATE INDEX "Project_userId_status_idx" ON "Project"("userId", "status");

-- CreateIndex
CREATE INDEX "File_projectId_updatedAt_idx" ON "File"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "Execution_status_updatedAt_idx" ON "Execution"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Node_executionId_status_idx" ON "Node"("executionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Node_executionId_order_type_key" ON "Node"("executionId", "order", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_nodeId_key" ON "Artifact"("nodeId");

-- CreateIndex
CREATE INDEX "Artifact_projectId_type_createdAt_idx" ON "Artifact"("projectId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_projectId_type_version_key" ON "Artifact"("projectId", "type", "version");

-- AddForeignKey
ALTER TABLE "VerificationReport" ADD CONSTRAINT "VerificationReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationReport" ADD CONSTRAINT "VerificationReport_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationReport" ADD CONSTRAINT "VerificationReport_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;