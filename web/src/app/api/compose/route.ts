import { NextResponse } from "next/server";
import {
  newExportPath,
  resolveLibraryFile,
  resolveTemplateFile,
  runBuilder,
  scrubPaths,
} from "@/lib/rytm";

export const dynamic = "force-dynamic";

type Body = {
  template?: "baked" | "custom";
  name: string;
  mode?: "project" | "edits";
  copies?: { path: string; pattern: string; dest: string }[];
  vacates?: string[];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const copies = body.copies ?? [];
    const vacates = body.vacates ?? [];
    const mode = body.mode === "edits" ? "edits" : "project";
    if (!body.name || (copies.length === 0 && vacates.length === 0)) {
      return NextResponse.json(
        { error: "need output name and at least one copy or vacate" },
        { status: 400 }
      );
    }
    const template = resolveTemplateFile(body.template);
    const stem = body.name.replace(/\.syx$/i, "");
    const outName = mode === "edits" ? `${stem}__edits` : stem;
    const out = newExportPath(outName);
    const report = out.replace(/\.syx$/i, ".txt");
    const args = ["compose", "--template", template, "--report", report];
    if (mode === "edits") {
      args.push("--edits-out", out);
    } else {
      args.push("--out", out);
    }
    for (const slot of vacates) {
      if (!slot) {
        return NextResponse.json({ error: "each vacate needs a dest slot" }, { status: 400 });
      }
      args.push("--vacate", slot);
    }
    for (const c of copies) {
      if (!c.pattern) {
        return NextResponse.json({ error: "each copy needs a pattern" }, { status: 400 });
      }
      if (!c.dest) {
        return NextResponse.json(
          { error: "each copy needs a dest slot (A01–H16)" },
          { status: 400 }
        );
      }
      const src =
        c.path === "@dest" || c.path === "__dest__"
          ? template
          : resolveLibraryFile(c.path);
      args.push("--copy", `${src}:${c.pattern}:${c.dest}`);
    }
    const { stdout } = await runBuilder(args);
    const file = `${outName}.syx`;
    return NextResponse.json({
      out: file,
      report: `${outName}.txt`,
      mode,
      text: scrubPaths(stdout),
    });
  } catch (e) {
    return NextResponse.json(
      { error: scrubPaths(e instanceof Error ? e.message : "compose failed") },
      { status: 500 }
    );
  }
}
