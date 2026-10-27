import { MemoryKind, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/src/hcr/agent-config/hash";
import {
  MEMORY_MAX_CONTENT_CHARS,
  memoryContentHash,
  memoryExpiry,
} from "./policy";
import type { MemoryCandidate, MemoryCurationTrigger } from "./types";

const MAX_VERIFICATION_REPORTS = 10;
const MAX_EXECUTIONS = 3;
const MAX_MESSAGES = 50;
const MAX_PREFERENCES = 5;
const PREFERENCE_SIGNAL =
  /\b(prefer|always|never|must|do not use|don't use|avoid)\b/i;

function bounded(content: string, limit = MEMORY_MAX_CONTENT_CHARS): string {
  return content.length > limit ? `${content.slice(0, limit)}...` : content;
}

function render(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function objectEntries(value: unknown): Array<[string, unknown]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>);
}

function candidateKey(candidate: MemoryCandidate): string {
  return `${candidate.kind}:${candidate.subject}:${memoryContentHash(
    candidate.content,
  )}`;
}

function dedupe(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const seen = new Set<string>();
  const kept: MemoryCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(candidate);
  }
  return kept;
}

/**
 * Deterministic curation sources. No model call: every candidate is derived
 * from durable product state with an explicit subject and provenance. This
 * keeps curation bounded, replayable, and independent of provider quality.
 */
export async function collectMemoryCandidates(input: {
  projectId: string;
  trigger: MemoryCurationTrigger;
  executionId?: string | null;
}): Promise<MemoryCandidate[]> {
  const { projectId, executionId } = input;

  const [memory, reports, executions, messages] = await Promise.all([
    prisma.projectMemory.findUnique({
      where: { projectId },
      select: {
        id: true,
        summary: true,
        requirements: true,
        techStack: true,
      },
    }),
    prisma.verificationReport.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_VERIFICATION_REPORTS,
      select: {
        id: true,
        status: true,
        command: true,
        exitCode: true,
      },
    }),
    prisma.execution.findMany({
      where: { workflow: { projectId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_EXECUTIONS,
      select: {
        id: true,
        attempt: true,
        status: true,
        completionStatus: true,
        failureReason: true,
        createdAt: true,
        _count: { select: { artifacts: true } },
      },
    }),
    prisma.message.findMany({
      where: { projectId, role: Role.USER },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_MESSAGES,
      select: { id: true, content: true },
    }),
  ]);

  const candidates: MemoryCandidate[] = [];
  const now = new Date();

  if (memory) {
    if (memory.summary.trim()) {
      candidates.push({
        scope: "PROJECT",
        kind: MemoryKind.SEMANTIC,
        subject: "summary",
        content: bounded(memory.summary),
        confidence: 0.9,
        sourceKind: "project-memory",
        sourceId: memory.id,
      });
    }
    for (const [key, value] of objectEntries(memory.requirements)) {
      candidates.push({
        scope: "PROJECT",
        kind: MemoryKind.SEMANTIC,
        subject: `requirements:${key}`,
        content: bounded(`${key}: ${render(value)}`),
        data: { key, value },
        confidence: 0.85,
        sourceKind: "project-memory",
        sourceId: memory.id,
      });
    }
    for (const [key, value] of objectEntries(memory.techStack)) {
      candidates.push({
        scope: "PROJECT",
        kind: MemoryKind.SEMANTIC,
        subject: `tech-stack:${key}`,
        content: bounded(`${key}: ${render(value)}`),
        data: { key, value },
        confidence: 0.85,
        sourceKind: "project-memory",
        sourceId: memory.id,
      });
    }
  }

  // Latest report per command: a newer run supersedes the older status.
  const seenCommands = new Set<string>();
  for (const report of reports) {
    const command = report.command ?? "unknown";
    if (seenCommands.has(command)) continue;
    seenCommands.add(command);
    candidates.push({
      scope: "PROJECT",
      kind: MemoryKind.PROCEDURAL,
      subject: `verification:${command}`,
      content: bounded(
        `${command}: ${report.status}${
          report.exitCode === null ? "" : ` (exit ${report.exitCode})`
        }`,
      ),
      data: { status: report.status, exitCode: report.exitCode },
      confidence: 0.8,
      sourceKind: "verification",
      sourceId: report.id,
    });
  }

  for (const execution of executions) {
    const outcome = execution.completionStatus
      ? `${execution.status} (${execution.completionStatus})`
      : execution.status;
    const reason = execution.failureReason
      ? ` — ${execution.failureReason.slice(0, 300)}`
      : "";
    candidates.push({
      scope: "PROJECT",
      kind: MemoryKind.EPISODIC,
      subject: `execution:${execution.id}`,
      content: bounded(
        `Attempt ${execution.attempt}: ${outcome}; ${execution._count.artifacts} artifact(s)${reason}`,
      ),
      data: {
        status: execution.status,
        attempt: execution.attempt,
        artifactCount: execution._count.artifacts,
      },
      confidence: 0.9,
      sourceKind: "execution",
      sourceId: execution.id,
      expiresAt: memoryExpiry(MemoryKind.EPISODIC, now)?.toISOString() ?? null,
    });
  }

  if (executionId && !executions.some((item) => item.id === executionId)) {
    // The triggering execution may be newer than the bounded window.
    const execution = await prisma.execution.findUnique({
      where: { id: executionId },
      select: {
        id: true,
        attempt: true,
        status: true,
        completionStatus: true,
        failureReason: true,
        _count: { select: { artifacts: true } },
      },
    });
    if (execution) {
      candidates.push({
        scope: "PROJECT",
        kind: MemoryKind.EPISODIC,
        subject: `execution:${execution.id}`,
        content: bounded(
          `Attempt ${execution.attempt}: ${execution.status} (${
            execution.completionStatus
          }); ${execution._count.artifacts} artifact(s)${
            execution.failureReason
              ? ` — ${execution.failureReason.slice(0, 300)}`
              : ""
          }`,
        ),
        data: {
          status: execution.status,
          attempt: execution.attempt,
          artifactCount: execution._count.artifacts,
        },
        confidence: 0.9,
        sourceKind: "execution",
        sourceId: execution.id,
        expiresAt: memoryExpiry(MemoryKind.EPISODIC, now)?.toISOString() ?? null,
      });
    }
  }

  for (const message of messages) {
    if (!PREFERENCE_SIGNAL.test(message.content)) continue;
    const content = bounded(message.content, 1_000);
    candidates.push({
      scope: "PROJECT",
      kind: MemoryKind.PREFERENCE,
      subject: `preference:${sha256(content).slice(0, 16)}`,
      content,
      confidence: 0.65,
      sourceKind: "message",
      sourceId: message.id,
    });
    if (
      candidates.filter((item) => item.kind === MemoryKind.PREFERENCE).length >=
      MAX_PREFERENCES
    ) {
      break;
    }
  }

  return dedupe(candidates);
}
