import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDbUser } from "@/lib/auth-user";
import { githubErrorResponse } from "@/lib/github-response";
import {
  listRecentPushes,
  previewPush,
} from "@/src/runtime/github/push";

const PreviewSchema = z.object({
  baseBranch: z.string().min(1).max(200).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;
  const { id: projectId } = await params;
  try {
    return NextResponse.json({
      pushes: await listRecentPushes(projectId, user.id),
    });
  } catch (cause) {
    return githubErrorResponse(cause);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id: projectId } = await params;
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = PreviewSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid push preview payload" },
      { status: 400 },
    );
  }

  try {
    const preview = await previewPush({
      projectId,
      userId: user.id,
      baseBranch: parsed.data.baseBranch,
    });
    return NextResponse.json({ preview });
  } catch (cause) {
    return githubErrorResponse(cause);
  }
}
