import type {
  PackageJsonShape,
  PackageManager,
  PackagePlan,
  PreviewPlan,
} from "./types";

export const PREVIEW_PORT = 4173;
export const PREVIEW_HOST = "0.0.0.0";

const LOCKFILE_ORDER: Array<{ file: string; manager: PackageManager }> = [
  { file: "bun.lock", manager: "bun" },
  { file: "bun.lockb", manager: "bun" },
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "package-lock.json", manager: "npm" },
];

const STATIC_DIRECTORIES = ["dist", "build", "out"];

/**
 * Lockfiles are more reliable than the `packageManager` field because a
 * generated project may not have been installed yet. The field is a fallback.
 */
export function detectPackageManager(
  files: readonly string[],
  pkg: PackageJsonShape = {},
): PackageManager {
  const present = new Set(files);
  for (const entry of LOCKFILE_ORDER) {
    if (present.has(entry.file)) return entry.manager;
  }

  const declared = pkg.packageManager?.split("@")[0];
  if (
    declared === "npm" ||
    declared === "pnpm" ||
    declared === "yarn" ||
    declared === "bun"
  ) {
    return declared;
  }
  return "npm";
}

export function runScriptCommand(
  manager: PackageManager,
  name: string,
): string {
  switch (manager) {
    case "npm":
      return `npm run ${name}`;
    case "pnpm":
      return `corepack pnpm run ${name}`;
    case "yarn":
      return `corepack yarn run ${name}`;
    case "bun":
      return `bun run ${name}`;
  }
}

function installCommand(manager: PackageManager): string {
  switch (manager) {
    case "npm":
      return "npm install --no-audit --no-fund";
    case "pnpm":
      return "corepack pnpm install";
    case "yarn":
      return "corepack yarn install";
    case "bun":
      return "bun install";
  }
}

function findStaticDirectory(files: readonly string[]): string | null {
  const present = new Set(files);
  for (const directory of STATIC_DIRECTORIES) {
    if (present.has(`${directory}/index.html`)) return directory;
  }
  return null;
}

function scriptFlagSuffix(script: string): string {
  if (script.includes("vite")) {
    return ` -- --host ${PREVIEW_HOST} --port ${PREVIEW_PORT}`;
  }
  if (script.includes("next")) {
    return ` -- -H ${PREVIEW_HOST} -p ${PREVIEW_PORT}`;
  }
  // Framework servers commonly honour PORT/HOST. The executor exports both.
  return "";
}

function planPreview(
  manager: PackageManager,
  pkg: PackageJsonShape,
  files: readonly string[],
): PreviewPlan {
  const scripts = pkg.scripts ?? {};
  for (const name of ["preview", "start"]) {
    const script = scripts[name];
    if (!script) continue;
    return {
      kind: "script",
      command: `${runScriptCommand(manager, name)}${scriptFlagSuffix(script)}`,
      port: PREVIEW_PORT,
    };
  }

  const directory = findStaticDirectory(files);
  if (directory) {
    return {
      kind: "static",
      command: `node /opt/doable/serve.mjs /workspace/${directory} ${PREVIEW_PORT}`,
      port: PREVIEW_PORT,
    };
  }
  return null;
}

/**
 * Derive only commands that exist in the project. Never accept a
 * model-supplied command: the sandbox executes this plan and nothing else.
 */
export function planVerification(
  pkg: PackageJsonShape,
  files: readonly string[],
): PackagePlan {
  const manager = detectPackageManager(files, pkg);
  const scripts = pkg.scripts ?? {};

  return {
    packageManager: manager,
    install: installCommand(manager),
    build: scripts.build ? runScriptCommand(manager, "build") : null,
    test: scripts.test ? runScriptCommand(manager, "test") : null,
    preview: planPreview(manager, pkg, files),
  };
}
