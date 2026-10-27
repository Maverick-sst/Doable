import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDbUser } from "@/lib/auth-user";
import { githubErrorResponse } from "@/lib/github-response";
import {
  cancelPush,
  confirmPush,
  getPush,
} from "@/src/runtime/github/push";

const ConfirmSchema = z.object({
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  allowDeletions: z.boolean().default(false),
  createPullRequest: z.boolean().default(false),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; pushId: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;
  const { id: projectId, pushId } = await params;
  try {
    return NextResponse.json({
      push: await getPush({ pushId, projectId, userId: user.id }),
    });
  } catch (cause) {
    return githubErrorResponse(cause);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; pushId: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;
  const { id: projectId, pushId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid push confirmation payload" },
      { status: 400 },
    );
  }

  try {
    const result = await confirmPush({
      pushId,
      projectId,
      userId: user.id,
      manifestHash: parsed.data.manifestHash,
      allowDeletions: parsed.data.allowDeletions,
      createPullRequest: parsed.data.createPullRequest,
    });
    return NextResponse.json({ push: result });
  } catch (cause) {
    return githubErrorResponse(cause);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; pushId: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;
  const { id: projectId, pushId } = await params;
  try {
    await cancelPush({ pushId, projectId, userId: user.id });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return githubErrorResponse(cause);
  }
}
