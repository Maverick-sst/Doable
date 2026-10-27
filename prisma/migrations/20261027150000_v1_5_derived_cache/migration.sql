-- CreateTable
CREATE TABLE "DerivedCache" (
    "key" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "projectId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DerivedCache_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "DerivedCache_projectId_namespace_idx" ON "DerivedCache"("projectId", "namespace");

-- CreateIndex
CREATE INDEX "DerivedCache_expiresAt_idx" ON "DerivedCache"("expiresAt");

-- AddForeignKey
ALTER TABLE "DerivedCache" ADD CONSTRAINT "DerivedCache_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
