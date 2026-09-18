import { NextResponse } from "next/server";
import fs from "fs";
import {
  activeTemplate,
  bakedTemplatePath,
  ensureAppDirs,
  safeSyxName,
  userTemplatePath,
} from "@/lib/rytm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const t = activeTemplate();
    return NextResponse.json({ kind: t.kind, name: t.name });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "template missing" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    ensureAppDirs();
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "drop a .syx dest base" }, { status: 400 });
    }
    safeSyxName(file.name);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length < 1000) {
      return NextResponse.json(
        { error: "file too small to be a whole-project dump" },
        { status: 400 }
      );
    }
    fs.writeFileSync(userTemplatePath(), buf);
    return NextResponse.json({ kind: "custom", name: "Dropped dest base" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "template import failed" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const custom = userTemplatePath();
    if (fs.existsSync(custom)) fs.unlinkSync(custom);
    if (!fs.existsSync(bakedTemplatePath())) {
      return NextResponse.json({ error: "baked template missing" }, { status: 500 });
    }
    return NextResponse.json({ kind: "baked", name: "Baked empty" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "reset failed" },
      { status: 500 }
    );
  }
}
