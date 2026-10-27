export type VerificationOutcome =
  | "PASSED"
  | "FAILED"
  | "TIMED_OUT"
  | "BLOCKED";

export interface VerificationWorkflowInput {
  projectId: string;
  userId: string;
  /** Pre-created RUNNING report shown in the UI. */
  reportId: string;
  executionId?: string | null;
  nodeId?: string | null;
  initialAttempt: number;
  maxAttempts: number;
  keepPreview?: boolean;
}

export interface VerificationWorkflowResult {
  reportId: string;
  status: VerificationOutcome;
  attempts: number;
  previewUrl: string | null;
  repaired: boolean;
  /** Report history, oldest first. */
  reportIds: string[];
}

export interface RunVerificationActivityInput {
  projectId: string;
  reportId?: string | null;
  parentReportId?: string | null;
  attempt: number;
  executionId?: string | null;
  nodeId?: string | null;
  keepPreview?: boolean;
}

export interface RunVerificationActivityOutput {
  reportId: string;
  status: VerificationOutcome;
  previewUrl: string | null;
  summary: string;
}

export interface RunRepairActivityInput {
  projectId: string;
  userId: string;
  reportId: string;
  attempt: number;
  executionId?: string | null;
  nodeId?: string | null;
}

export interface CreateBuildVerificationReportInput {
  projectId: string;
  executionId: string;
  nodeId: string;
}

export interface CreateBuildVerificationReportOutput {
  reportId: string | null;
  reason?: string;
}

export interface RunRepairActivityOutput {
  changed: boolean;
  reportId: string;
  executionId: string | null;
  nodeId: string | null;
  filesChanged: string[];
  summary: string;
}

export function buildVerificationWorkflowId(reportId: string): string {
  return `verification-${reportId}`;
}
