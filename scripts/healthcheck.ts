const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000").replace(
  /\/+$/,
  "",
);

async function main() {
  const response = await fetch(`${baseUrl}/api/health`, {
    signal: AbortSignal.timeout(5000),
  });
  const body = (await response.json()) as {
    database?: { ok?: boolean; error?: string };
    temporal?: { ok?: boolean; error?: string; host?: string };
    workspaceRoot?: string;
    authMode?: string;
    provider?: string;
  };

  console.log(`Doable health: ${response.status}`);
  console.log(`  auth:      ${body.authMode ?? "unknown"}`);
  console.log(`  provider:  ${body.provider ?? "unknown"}`);
  console.log(`  workspace: ${body.workspaceRoot ?? "unknown"}`);
  console.log(
    `  database:  ${body.database?.ok ? "ready" : `unavailable (${body.database?.error ?? "unknown"})`}`,
  );
  console.log(
    `  temporal:  ${body.temporal?.ok ? `ready (${body.temporal.host ?? "unknown"})` : `unavailable (${body.temporal?.error ?? "unknown"})`}`,
  );

  if (!body.database?.ok) process.exit(1);
}

main().catch((error) => {
  console.error(
    "Health check failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});