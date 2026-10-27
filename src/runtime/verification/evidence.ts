import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface BrowserEvidence {
  available: boolean;
  reason?: string;
  url?: string;
  title?: string;
  httpStatus?: number;
  screenshotPath?: string;
  screenshotUrl?: string;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: Array<{ url: string; error: string }>;
  blockedRequests: string[];
  httpErrors: Array<{ url: string; status: number }>;
  domSnapshot?: string;
  durationMs: number;
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^\[?::1\]?$/,
  /\.local$/i,
  /\.internal$/i,
  /^metadata\.google\.internal$/i,
];

export function isPrivateOrLocalHost(hostname: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

export function getEvidenceRoot(): string {
  const configured = process.env.DOABLE_HOME;
  const root = configured
    ? path.resolve(configured)
    : path.join(process.cwd(), ".doable");
  return path.join(root, "evidence");
}

export function getEvidenceDir(projectId: string, runId: string): string {
  return path.join(getEvidenceRoot(), projectId, runId);
}

export async function saveEvidenceScreenshot(
  projectId: string,
  runId: string,
  buffer: Buffer,
): Promise<{ absolutePath: string; relativePath: string; url: string }> {
  const directory = getEvidenceDir(projectId, runId);
  await mkdir(directory, { recursive: true });
  const absolutePath = path.join(directory, "screenshot.png");
  await writeFile(absolutePath, buffer);
  return {
    absolutePath,
    relativePath: "screenshot.png",
    url: `/api/projects/${projectId}/evidence/${runId}/screenshot.png`,
  };
}

async function findChrome(): Promise<string | null> {
  const candidates = [
    process.env.DOABLE_BROWSER_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function blockedRequestReason(rawUrl: string, previewOrigin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "invalid_url";
  }
  if (parsed.protocol === "data:" || parsed.protocol === "blob:") return null;
  if (parsed.origin === previewOrigin) return null;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "unsupported_protocol";
  }
  if (isPrivateOrLocalHost(parsed.hostname)) return "private_network";
  return null;
}

function bounded(value: string, max = 2_000): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Browser probe for the live preview. The browser runs on the host because
 * the sandbox has no Chromium; requests to private networks (other than the
 * loopback preview itself) are blocked by an explicit route guard.
 */
export async function captureBrowserEvidence(input: {
  projectId: string;
  runId: string;
  previewUrl: string;
  timeoutMs?: number;
}): Promise<BrowserEvidence> {
  const started = Date.now();
  const empty: BrowserEvidence = {
    available: false,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    blockedRequests: [],
    httpErrors: [],
    durationMs: 0,
  };

  let playwright: typeof import("playwright-core");
  try {
    playwright = await import("playwright-core");
  } catch {
    return { ...empty, reason: "playwright-core is not installed", durationMs: Date.now() - started };
  }

  const executablePath = await findChrome();
  if (!executablePath) {
    return {
      ...empty,
      reason: "No system Chrome/Chromium found for the visual probe",
      durationMs: Date.now() - started,
    };
  }

  const previewOrigin = new URL(input.previewUrl).origin;
  let browser: Awaited<ReturnType<typeof playwright.chromium.launch>> | null = null;

  try {
    try {
      browser = await playwright.chromium.launch({
        headless: true,
        executablePath,
        args: ["--disable-dev-shm-usage", "--disable-gpu"],
      });
    } catch {
      browser = await playwright.chromium.launch({
        headless: true,
        executablePath,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      const reason = blockedRequestReason(url, previewOrigin);
      if (reason) {
        await route.abort(reason === "private_network" ? "addressunreachable" : "blockedbyclient");
        return;
      }
      await route.continue();
    });

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: Array<{ url: string; error: string }> = [];
    const blockedRequests: string[] = [];
    const httpErrors: Array<{ url: string; status: number }> = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(bounded(message.text()));
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(bounded(error.message));
    });
    page.on("requestfailed", (request) => {
      const error = request.failure()?.errorText ?? "failed";
      if (error.includes("blockedbyclient") || error.includes("addressunreachable")) {
        blockedRequests.push(bounded(request.url(), 500));
      } else {
        failedRequests.push({ url: bounded(request.url(), 500), error: bounded(error) });
      }
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        httpErrors.push({
          url: bounded(response.url(), 500),
          status: response.status(),
        });
      }
    });

    const response = await page.goto(input.previewUrl, {
      waitUntil: "domcontentloaded",
      timeout: input.timeoutMs ?? 30_000,
    });
    await page.waitForTimeout(1_500);
    try {
      await page.waitForLoadState("networkidle", { timeout: 5_000 });
    } catch {
      // Long-polling apps are still inspectable.
    }

    const screenshot = await page.screenshot({
      fullPage: true,
      animations: "disabled",
      timeout: 20_000,
    });
    const saved = await saveEvidenceScreenshot(
      input.projectId,
      input.runId,
      Buffer.from(screenshot),
    );

    const domSnapshot = bounded(await page.content(), 200_000);

    return {
      available: true,
      url: input.previewUrl,
      title: bounded(await page.title(), 500),
      httpStatus: response?.status(),
      screenshotPath: saved.relativePath,
      screenshotUrl: saved.url,
      consoleErrors: consoleErrors.slice(0, 50),
      pageErrors: pageErrors.slice(0, 50),
      failedRequests: failedRequests.slice(0, 50),
      blockedRequests: blockedRequests.slice(0, 50),
      httpErrors: httpErrors.slice(0, 50),
      domSnapshot,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ...empty,
      reason: bounded(error instanceof Error ? error.message : String(error), 500),
      durationMs: Date.now() - started,
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
