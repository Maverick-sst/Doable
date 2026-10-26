import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { exportProjectZip } from "@/src/runtime/workspace";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id: projectId } = await params;
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: user.id },
    select: { id: true, name: true },
  });
  if (!project) {
    return new Response(JSON.stringify({ error: "Project not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const archive = await exportProjectZip(projectId);
  const filename = `${project.name.trim().replace(/[^A-Za-z0-9._-]+/g, "-") || "doable-project"}.zip`;

  return new Response(new Uint8Array(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}