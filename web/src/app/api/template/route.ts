import { NextResponse } from "next/server";
import fs from "fs";
import {
  bakedTemplatePath,
  catalogDestTemplate,
  emptyDestCatalog,
  ensureAppDirs,
  safeSyxName,
  userTemplateLabelPath,
  userTemplatePath,
} from "@/lib/rytm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await catalogDestTemplate();
    return NextResponse.json(result);
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
    const name = safeSyxName(file.name);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length < 1000) {
      return NextResponse.json(
        { error: "file too small to be a whole-project dump" },
        { status: 400 }
      );
    }
    fs.writeFileSync(userTemplatePath(), buf);
    fs.writeFileSync(userTemplateLabelPath(), name);
    const result = await catalogDestTemplate();
    return NextResponse.json(result);
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
    const label = userTemplateLabelPath();
    if (fs.existsSync(custom)) fs.unlinkSync(custom);
    if (fs.existsSync(label)) fs.unlinkSync(label);
    if (!fs.existsSync(bakedTemplatePath())) {
      return NextResponse.json({ error: "baked template missing" }, { status: 500 });
    }
    return NextResponse.json({
      kind: "baked",
      name: "Baked empty",
      catalog: emptyDestCatalog(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "reset failed" },
      { status: 500 }
    );
  }
}
