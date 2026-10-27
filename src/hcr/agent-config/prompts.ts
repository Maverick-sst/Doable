import {
  ARCHITECT_SYSTEM_PROMPT,
  BACKEND_ENGINEER_SYSTEM_PROMPT,
  FRONTEND_ENGINEER_SYSTEM_PROMPT,
  PRD_REVIEWER_SYSTEM_PROMPT,
  RESEARCHER_SYSTEM_PROMPT,
  STAFF_ENGINEER_SYSTEM_PROMPT,
} from "@/src/cognition/prompts";
import { sha256 } from "./hash";
import type { AgentType } from "./types";

/**
 * Prompt identity is explicit so a run can be reproduced from the version and
 * hash recorded on its node. Bump `version` whenever prompt wording changes;
 * the hash is derived from the content, so an unversioned edit is still
 * detectable.
 */
export interface VersionedPrompt {
  id: string;
  version: string;
  hash: string;
  content: string;
}

export const PROMPT_CATALOG_VERSION = "1.0.0";

function versionedPrompt(
  id: string,
  content: string,
  version: string = PROMPT_CATALOG_VERSION,
): VersionedPrompt {
  return { id, version, hash: sha256(content), content };
}

export const AGENT_PROMPTS: Record<AgentType, VersionedPrompt> = {
  ARCHITECT: versionedPrompt("architect-system", ARCHITECT_SYSTEM_PROMPT),
  RESEARCHER: versionedPrompt("researcher-system", RESEARCHER_SYSTEM_PROMPT),
  PRD_REVIEWER: versionedPrompt("prd-reviewer-system", PRD_REVIEWER_SYSTEM_PROMPT),
  STAFF_ENGINEER: versionedPrompt("staff-engineer-system", STAFF_ENGINEER_SYSTEM_PROMPT),
  FRONTEND_ENG: versionedPrompt("frontend-engineer-system", FRONTEND_ENGINEER_SYSTEM_PROMPT),
  BACKEND_ENG: versionedPrompt("backend-engineer-system", BACKEND_ENGINEER_SYSTEM_PROMPT),
};
