-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('WORKING', 'EPISODIC', 'SEMANTIC', 'PROCEDURAL', 'PREFERENCE');

-- CreateEnum
CREATE TYPE "MemoryStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'DELETED');

-- CreateEnum
CREATE TYPE "MemoryScope" AS ENUM ('PROJECT', 'USER');

-- CreateTable
CREATE TABLE "MemoryEntry" (
    "id" TEXT NOT NULL,
    "scope" "MemoryScope" NOT NULL DEFAULT 'PROJECT',
    "kind" "MemoryKind" NOT NULL,
    "status" "MemoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "data" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sourceKind" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceRefs" JSONB,
    "contentHash" TEXT NOT NULL,
    "contentKey" TEXT NOT NULL,
    "supersededById" TEXT,
    "supersededAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletionReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "embedding" vector(768),
    "embeddingStatus" "EmbeddingStatus" NOT NULL DEFAULT 'EMBEDDING_PENDING',
    "projectId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemoryEntry_contentKey_key" ON "MemoryEntry"("contentKey");

-- CreateIndex
CREATE INDEX "MemoryEntry_projectId_kind_status_idx" ON "MemoryEntry"("projectId", "kind", "status");

-- CreateIndex
CREATE INDEX "MemoryEntry_projectId_subject_status_idx" ON "MemoryEntry"("projectId", "subject", "status");

-- CreateIndex
CREATE INDEX "MemoryEntry_userId_kind_status_idx" ON "MemoryEntry"("userId", "kind", "status");

-- CreateIndex
CREATE INDEX "MemoryEntry_expiresAt_status_idx" ON "MemoryEntry"("expiresAt", "status");

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
