import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireDbUser } from "@/lib/auth-user";
import { prisma } from "@/lib/prisma";
import { getEvidenceDir } from "@/src/runtime/verification";

const ALLOWED_FILES = new Set(["screenshot.png"]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const { user, error } = await requireDbUser();
  if (error) return error;

  const { id, path: segments } = await params;
  if (segments.length !== 2) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [reportId, filename] = segments;
  if (!ALLOWED_FILES.has(filename)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const report = await prisma.verificationReport.findFirst({
    where: {
      id: reportId,
      projectId: id,
      project: { userId: user.id },
    },
    select: { id: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const directory = path.resolve(getEvidenceDir(id, reportId));
  const filePath = path.resolve(directory, filename);
  if (!filePath.startsWith(`${directory}${path.sep}`)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const bytes = await readFile(filePath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": "image/png",
        "content-length": String(bytes.byteLength),
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
