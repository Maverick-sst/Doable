/*
  Warnings:

  - You are about to drop the column `context` on the `Project` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "MessagePhase" AS ENUM ('DISCOVERY', 'BUILD');

-- AlterEnum
ALTER TYPE "ProjectStatus" ADD VALUE 'DISCOVERY';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "phase" "MessagePhase" NOT NULL DEFAULT 'BUILD';

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "context";
