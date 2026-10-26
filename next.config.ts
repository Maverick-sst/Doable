import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // Prisma, pg, and the Temporal SDK must stay in the Node runtime rather
  // than being bundled into the Next server graph.
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "@prisma/adapter-neon",
    "pg",
    "@temporalio/client",
    "@temporalio/worker",
    "@temporalio/activity",
  ],
};

export default nextConfig;