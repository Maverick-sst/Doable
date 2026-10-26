-- V1.2 durable runs: attempt lineage, honest terminal states, tool-call
-- idempotency, and agent-config version capture.
--
-- Preflight: refuse to add uniqueness that existing data would violate.
-- The migration is additive; it never deletes project data.

-- CreateEnum
CREATE TYPE "ToolCallStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ProjectStatus" ADD VALUE 'INCOMPLETE';

-- AlterEnum
ALTER TYPE "ExecutionStatus" ADD VALUE 'PARTIAL';

-- AlterEnum
ALTER TYPE "NodeStatus" ADD VALUE 'INCOMPLETE';

-- AlterTable
ALTER TABLE "Execution" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "parentExecutionId" TEXT,
ADD COLUMN "resumedFromNodeType" "NodeType",
ADD COLUMN "completionStatus" TEXT NOT NULL DEFAULT 'COMPLETE';

-- AlterTable
ALTER TABLE "Node" ADD COLUMN "agentConfigVersion" TEXT,
ADD COLUMN "agentConfigHash" TEXT;

-- AlterTable
ALTER TABLE "File" ADD COLUMN "toolCallKey" TEXT;

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "nodeId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "toolVersion" TEXT,
    "argumentsHash" TEXT NOT NULL,
    "status" "ToolCallStatus" NOT NULL DEFAULT 'STARTED',
    "result" TEXT,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ToolCall_idempotencyKey_key" ON "ToolCall"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ToolCall_executionId_nodeId_idx" ON "ToolCall"("executionId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "File_toolCallKey_key" ON "File"("toolCallKey");

-- CreateIndex
CREATE INDEX "Execution_parentExecutionId_idx" ON "Execution"("parentExecutionId");

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_parentExecutionId_fkey" FOREIGN KEY ("parentExecutionId") REFERENCES "Execution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preflight (runs after the columns exist, inside the migration transaction,
-- so a violation rolls the whole migration back):
-- one attempt number per build.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Execution"
    GROUP BY "workflowId", "attempt"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate (workflowId, attempt) executions exist. Reconcile before applying 20261026160000_v1_2_durable_runs.';
  END IF;
END $$;
