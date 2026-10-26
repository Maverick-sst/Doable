/*
  Warnings:

  - The values [DISCOVERY,HCR] on the enum `WorkflowType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `parentNodeId` on the `Node` table. All the data in the column will be lost.
  - You are about to drop the `Artifact` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "WorkflowType_new" AS ENUM ('MVP_GENERATION', 'FEATURE_EXPANSION', 'REPAIR', 'DEPLOYMENT');
ALTER TABLE "Workflow" ALTER COLUMN "type" TYPE "WorkflowType_new" USING ("type"::text::"WorkflowType_new");
ALTER TYPE "WorkflowType" RENAME TO "WorkflowType_old";
ALTER TYPE "WorkflowType_new" RENAME TO "WorkflowType";
DROP TYPE "public"."WorkflowType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Artifact" DROP CONSTRAINT "Artifact_parentArtifactId_fkey";

-- DropForeignKey
ALTER TABLE "Node" DROP CONSTRAINT "Node_parentNodeId_fkey";

-- AlterTable
ALTER TABLE "Node" DROP COLUMN "parentNodeId";

-- DropTable
DROP TABLE "Artifact";
