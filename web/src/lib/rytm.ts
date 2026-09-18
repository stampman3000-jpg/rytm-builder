import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export function repoRoot(): string {
  if (process.env.RYTM_ROOT) return process.env.RYTM_ROOT;
  const cwd = process.cwd();
  if (path.basename(cwd) === "web") return path.resolve(cwd, "..");
  return cwd;
}

export function appHome(): string {
  if (process.env.RYTM_APP_HOME) return process.env.RYTM_APP_HOME;
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "rytm-builder"
  );
}

export function libraryDir(): string {
  return path.join(appHome(), "library");
}

export function exportsDir(): string {
  return path.join(appHome(), "exports");
}

export function userTemplatePath(): string {
  return path.join(appHome(), "template-override.syx");
}

export function bakedTemplatePath(): string {
  return path.join(repoRoot(), "web", "templates", "Untitled-4.syx");
}

export function ensureAppDirs(): void {
  fs.mkdirSync(libraryDir(), { recursive: true });
  fs.mkdirSync(exportsDir(), { recursive: true });
}

export function activeTemplate(): { kind: "baked" | "custom"; path: string; name: string } {
  const custom = userTemplatePath();
  if (fs.existsSync(custom)) {
    return { kind: "custom", path: custom, name: "Dropped dest base" };
  }
  const baked = bakedTemplatePath();
  if (!fs.existsSync(baked)) {
    throw new Error("baked empty template is missing (web/templates/Untitled-4.syx)");
  }
  return { kind: "baked", path: baked, name: "Baked empty" };
}

const SAFE_NAME = /^[A-Za-z0-9._-]{1,80}\.syx$/i;

export function safeSyxName(name: string): string {
  const base = path.basename(name).replace(/\s+/g, "_");
  if (!SAFE_NAME.test(base)) {
    throw new Error(
      "file name may only use letters, numbers, dot, dash, underscore, and .syx"
    );
  }
  return base;
}

function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function underDir(file: string, dir: string): boolean {
  const d = realOrSelf(dir);
  const f = realOrSelf(file);
  return f === d || f.startsWith(d + path.sep);
}

export function resolveLibraryFile(nameOrPath: string): string {
  ensureAppDirs();
  const name = path.basename(nameOrPath);
  const p = path.join(libraryDir(), name);
  if (!fs.existsSync(p)) {
    throw new Error(`not in library: ${name}`);
  }
  const resolved = fs.realpathSync(p);
  if (!underDir(resolved, libraryDir())) {
    throw new Error("path is outside the library");
  }
  return resolved;
}

export function resolveTemplateFile(kind?: string | null): string {
  const active = activeTemplate();
  if (kind === "baked") {
    const baked = bakedTemplatePath();
    if (!fs.existsSync(baked)) throw new Error("baked template missing");
    return fs.realpathSync(baked);
  }
  if (kind === "custom") {
    const custom = userTemplatePath();
    if (!fs.existsSync(custom)) throw new Error("no dropped dest base");
    return fs.realpathSync(custom);
  }
  return fs.realpathSync(active.path);
}

export function newExportPath(stem: string): string {
  ensureAppDirs();
  const base = stem.trim().replace(/\.syx$/i, "");
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(base)) {
    throw new Error(
      "output name may only use letters, numbers, dot, dash, underscore"
    );
  }
  const dir = fs.realpathSync(exportsDir());
  const out = path.join(dir, `${base}.syx`);
  if (!out.startsWith(dir + path.sep)) {
    throw new Error("path is outside the export folder");
  }
  if (fs.existsSync(out)) {
    throw new Error(`output already exists: ${path.basename(out)} — pick a new name`);
  }
  return out;
}

export type DumpKind = "library" | "composed";

export function dumpKind(name: string): DumpKind {
  const n = name.toLowerCase();
  if (n.startsWith("fresh") || n.startsWith("gatec") || n.includes("__")) {
    return "composed";
  }
  return "library";
}

export function builderBin(): string {
  return (
    process.env.RYTM_BUILDER ||
    path.join(repoRoot(), "target/debug/rytm-builder")
  );
}

export async function runBuilder(
  args: string[],
  timeoutMs = 120_000
): Promise<{ stdout: string; stderr: string }> {
  const bin = builderBin();
  if (!fs.existsSync(bin)) {
    throw new Error(
      `rytm-builder binary not found at ${bin} — run cargo build in the repo root`
    );
  }
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      message?: string;
      killed?: boolean;
    };
    const msg = (e.stderr || e.stdout || e.message || "rytm-builder failed").trim();
    throw new Error(msg.replace(/^error:\s*/i, ""));
  }
}

export function scrubPaths(text: string): string {
  const home = os.homedir();
  return text
    .split(home)
    .join("~")
    .split(repoRoot())
    .join("rytm-builder");
}
