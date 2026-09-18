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
  copies: { path: string; pattern: string; dest: string }[];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.name || !Array.isArray(body.copies) || body.copies.length === 0) {
      return NextResponse.json(
        { error: "need output name and at least one pattern" },
        { status: 400 }
      );
    }
    const template = resolveTemplateFile(body.template);
    const out = newExportPath(body.name);
    const report = out.replace(/\.syx$/i, ".txt");
    const args = ["compose", "--template", template, "--out", out, "--report", report];
    for (const c of body.copies) {
      if (!c.pattern) {
        return NextResponse.json({ error: "each copy needs a pattern" }, { status: 400 });
      }
      if (!c.dest) {
        return NextResponse.json(
          { error: "each copy needs a dest slot (A01–H16)" },
          { status: 400 }
        );
      }
      const src = resolveLibraryFile(c.path);
      args.push("--copy", `${src}:${c.pattern}:${c.dest}`);
    }
    const { stdout } = await runBuilder(args);
    return NextResponse.json({
      out: `${body.name.replace(/\.syx$/i, "")}.syx`,
      report: `${body.name.replace(/\.syx$/i, "")}.txt`,
      text: scrubPaths(stdout),
    });
  } catch (e) {
    return NextResponse.json(
      { error: scrubPaths(e instanceof Error ? e.message : "compose failed") },
      { status: 500 }
    );
  }
}
