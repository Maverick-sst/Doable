/*
  Warnings:

  - A unique constraint covering the columns `[projectId,path]` on the table `File` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "EmbeddingStatus" AS ENUM ('EMBEDDING_PENDING', 'EMBEDDING_PROCESSING', 'EMBEDDING_SUCCESSFUL', 'EMBEDDING_RETRYING', 'EMBEDDING_FAILED');

-- AlterTable
ALTER TABLE "File" ADD COLUMN     "embeddingStatus" "EmbeddingStatus" NOT NULL DEFAULT 'EMBEDDING_PENDING';

-- CreateIndex
CREATE UNIQUE INDEX "File_projectId_path_key" ON "File"("projectId", "path");
