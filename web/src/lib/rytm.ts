import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export function dumpsDir(): string {
  return (
    process.env.RYTM_DUMPS ||
    "/cursor/stores/bc-c324e27c-232d-4ce2-ba9b-0f511bc4829c/dumps"
  );
}

export function repoRoot(): string {
  if (process.env.RYTM_ROOT) return process.env.RYTM_ROOT;
  const cwd = process.cwd();
  if (path.basename(cwd) === "web") return path.resolve(cwd, "..");
  return cwd;
}

export function builderBin(): string {
  return (
    process.env.RYTM_BUILDER ||
    path.join(repoRoot(), "target/debug/rytm-builder")
  );
}

export function resolveInsideDumps(relOrAbs: string): string {
  const dumps = fs.realpathSync(dumpsDir());
  const candidate = path.isAbsolute(relOrAbs)
    ? relOrAbs
    : path.join(dumps, relOrAbs);
  const resolved = fs.realpathSync(candidate);
  if (resolved !== dumps && !resolved.startsWith(dumps + path.sep)) {
    throw new Error("path is outside the dumps folder");
  }
  return resolved;
}

export function newDumpPath(stem: string): string {
  const dumps = fs.realpathSync(dumpsDir());
  const base = stem.trim().replace(/\.syx$/i, "");
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(base)) {
    throw new Error(
      "output name may only use letters, numbers, dot, dash, underscore"
    );
  }
  const out = path.join(dumps, `${base}.syx`);
  if (!out.startsWith(dumps + path.sep)) {
    throw new Error("path is outside the dumps folder");
  }
  if (fs.existsSync(out)) {
    throw new Error(`output already exists: ${path.basename(out)} — pick a new name`);
  }
  return out;
}

export type DumpKind = "template" | "library" | "composed";

export function dumpKind(name: string): DumpKind {
  const n = name.toLowerCase();
  if (n === "untitled-4.syx") return "template";
  if (
    n.startsWith("fresh") ||
    n.startsWith("gatec") ||
    n.includes("__")
  ) {
    return "composed";
  }
  return "library";
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
