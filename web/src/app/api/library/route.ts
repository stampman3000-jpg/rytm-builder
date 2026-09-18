import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { ensureAppDirs, libraryDir, safeSyxName } from "@/lib/rytm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    ensureAppDirs();
    const form = await req.formData();
    const files = form.getAll("files");
    if (files.length === 0) {
      return NextResponse.json({ error: "drop one or more .syx files" }, { status: 400 });
    }
    const imported: string[] = [];
    const skipped: string[] = [];
    for (const item of files) {
      if (typeof item === "string") continue;
      let name: string;
      try {
        name = safeSyxName(item.name);
      } catch (e) {
        skipped.push(e instanceof Error ? e.message : String(item.name));
        continue;
      }
      const dest = path.join(libraryDir(), name);
      if (fs.existsSync(dest)) {
        skipped.push(`${name} already in library`);
        continue;
      }
      const buf = Buffer.from(await item.arrayBuffer());
      if (buf.length < 1000) {
        skipped.push(`${name} too small to be a whole-project dump`);
        continue;
      }
      fs.writeFileSync(dest, buf);
      imported.push(name);
    }
    if (imported.length === 0 && skipped.length > 0) {
      return NextResponse.json(
        { error: skipped.join("; "), imported, skipped },
        { status: 400 }
      );
    }
    return NextResponse.json({ imported, skipped });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "import failed" },
      { status: 500 }
    );
  }
}
