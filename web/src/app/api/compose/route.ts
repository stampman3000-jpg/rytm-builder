import { NextResponse } from "next/server";
import { newDumpPath, resolveInsideDumps, runBuilder } from "@/lib/rytm";

export const dynamic = "force-dynamic";

type Body = {
  template: string;
  name: string;
  copies: { path: string; pattern: string }[];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.template || !body.name || !Array.isArray(body.copies) || body.copies.length === 0) {
      return NextResponse.json(
        { error: "need template, output name, and at least one pattern" },
        { status: 400 }
      );
    }
    const template = resolveInsideDumps(body.template);
    const out = newDumpPath(body.name);
    const report = out.replace(/\.syx$/i, ".txt");
    const args = ["compose", "--template", template, "--out", out, "--report", report];
    for (const c of body.copies) {
      const src = resolveInsideDumps(c.path);
      if (!c.pattern) {
        return NextResponse.json({ error: "each copy needs a pattern" }, { status: 400 });
      }
      args.push("--copy", `${src}:${c.pattern}`);
    }
    const { stdout } = await runBuilder(args);
    return NextResponse.json({
      out,
      report,
      text: stdout,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "compose failed" },
      { status: 500 }
    );
  }
}
