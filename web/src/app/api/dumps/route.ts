import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { dumpKind, dumpsDir } from "@/lib/rytm";
import type { DumpInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const dir = dumpsDir();
    if (!fs.existsSync(dir)) {
      return NextResponse.json(
        { error: `dumps folder not found: ${dir}` },
        { status: 404 }
      );
    }
    const names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".syx"));
    names.sort((a, b) => a.localeCompare(b));
    const dumps: DumpInfo[] = names.map((name) => {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      return {
        name,
        path: p,
        bytes: st.size,
        kind: dumpKind(name),
      };
    });
    const template =
      dumps.find((d) => d.kind === "template")?.path ??
      dumps.find((d) => d.name.toLowerCase().includes("untitled-4"))?.path ??
      null;
    return NextResponse.json({ dir, dumps, template });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to list dumps" },
      { status: 500 }
    );
  }
}
