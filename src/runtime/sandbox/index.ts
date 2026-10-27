import { KubernetesSandboxAdapter } from "./kubernetes";
import type { SandboxAdapter } from "./types";

let cached: SandboxAdapter | null = null;

/**
 * The only sandbox selection point. `sandbox` is deliberate: verification and
 * repair receive this interface, not kubectl details.
 */
export function getSandboxAdapter(): SandboxAdapter {
  if (cached) return cached;
  cached = new KubernetesSandboxAdapter();
  return cached;
}

export type {
  PackagePlan,
  PreviewPlan,
  SandboxAdapter,
  SandboxAvailability,
  SandboxCreateOptions,
  SandboxExecResult,
  SandboxHandle,
  SandboxPreview,
} from "./types";
export { planVerification, PREVIEW_PORT } from "./commands";
export { SandboxError } from "./kubernetes";
