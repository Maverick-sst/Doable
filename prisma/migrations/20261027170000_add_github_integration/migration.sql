-- CreateEnum
CREATE TYPE "GitHubPushStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "GitHubConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "tokenIv" TEXT NOT NULL,
    "tokenTag" TEXT NOT NULL,
    "tokenLast4" TEXT NOT NULL,
    "scopes" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectGitHubLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "connectionId" TEXT,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectGitHubLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubPush" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "connectionId" TEXT,
    "userId" TEXT NOT NULL,
    "status" "GitHubPushStatus" NOT NULL DEFAULT 'PENDING',
    "branch" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "baseSha" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "commitSha" TEXT,
    "pullRequestUrl" TEXT,
    "pullRequestNumber" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GitHubPush_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitHubConnection_userId_key" ON "GitHubConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectGitHubLink_projectId_key" ON "ProjectGitHubLink"("projectId");

-- CreateIndex
CREATE INDEX "ProjectGitHubLink_connectionId_idx" ON "ProjectGitHubLink"("connectionId");

-- CreateIndex
CREATE INDEX "GitHubPush_projectId_createdAt_idx" ON "GitHubPush"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "GitHubPush_userId_createdAt_idx" ON "GitHubPush"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "GitHubConnection" ADD CONSTRAINT "GitHubConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectGitHubLink" ADD CONSTRAINT "ProjectGitHubLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectGitHubLink" ADD CONSTRAINT "ProjectGitHubLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GitHubConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubPush" ADD CONSTRAINT "GitHubPush_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubPush" ADD CONSTRAINT "GitHubPush_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "GitHubConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubPush" ADD CONSTRAINT "GitHubPush_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

