import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  activeTemplate,
  dumpKind,
  ensureAppDirs,
  libraryDir,
} from "@/lib/rytm";
import type { DumpInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ensureAppDirs();
    const dir = libraryDir();
    const names = fs
      .readdirSync(dir)
      .filter((n) => n.toLowerCase().endsWith(".syx"));
    names.sort((a, b) => a.localeCompare(b));
    const dumps: DumpInfo[] = names.map((name) => {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      return {
        name,
        path: name,
        bytes: st.size,
        kind: dumpKind(name),
      };
    });
    const template = activeTemplate();
    return NextResponse.json({
      dumps,
      template: {
        kind: template.kind,
        name: template.name,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to list library" },
      { status: 500 }
    );
  }
}
