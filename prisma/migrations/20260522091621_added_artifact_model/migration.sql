/*
  Warnings:

  - The values [MVP_GENERATION,FEATURE_EXPANSION,REPAIR,DEPLOYMENT] on the enum `WorkflowType` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('DISCOVERY_REQUIREMENT', 'ARCHITECTURE_SPEC', 'RESEARCH_DOSSIER', 'APPROVED_PRD', 'EXECUTION_PLAN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "NodeType" ADD VALUE 'DISCOVERY';
ALTER TYPE "NodeType" ADD VALUE 'WORKER';

-- AlterEnum
BEGIN;
CREATE TYPE "WorkflowType_new" AS ENUM ('DISCOVERY', 'HCR');
ALTER TABLE "Workflow" ALTER COLUMN "type" TYPE "WorkflowType_new" USING ("type"::text::"WorkflowType_new");
ALTER TYPE "WorkflowType" RENAME TO "WorkflowType_old";
ALTER TYPE "WorkflowType_new" RENAME TO "WorkflowType";
DROP TYPE "public"."WorkflowType_old";
COMMIT;

-- AlterTable
ALTER TABLE "Node" ADD COLUMN "parentNodeId" TEXT;

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "executionId" TEXT,
    "nodeId" TEXT,
    "type" "ArtifactType" NOT NULL,
    "version" INTEGER NOT NULL,
    "producedBy" "NodeType" NOT NULL,
    "content" JSONB NOT NULL,
    "metadata" JSONB,
    "parentArtifactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_parentNodeId_fkey" FOREIGN KEY ("parentNodeId") REFERENCES "Node"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_parentArtifactId_fkey" FOREIGN KEY ("parentArtifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;