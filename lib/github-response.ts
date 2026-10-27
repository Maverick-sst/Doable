import { NextResponse } from "next/server";
import { asGitHubError } from "@/src/runtime/github/errors";

export function githubErrorResponse(error: unknown): NextResponse {
  const safe = asGitHubError(error);
  return NextResponse.json(
    { error: safe.message, code: safe.code },
    { status: safe.httpStatus },
  );
}
