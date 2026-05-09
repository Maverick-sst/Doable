export const runtime = "nodejs";

import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        const data = await prisma.project.findMany();

        return Response.json({
            success: true,
            data
        });
    } catch (error) {
        console.error(error);

        return Response.json({
            success: false,
            error: String(error)
        });
    }
}