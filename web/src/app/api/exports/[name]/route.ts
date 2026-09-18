import { NextResponse } from "next/server";
import fs from "fs";
import { resolveExportFile } from "@/lib/rytm";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await ctx.params;
    const file = resolveExportFile(name);
    const buf = fs.readFileSync(file);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "export not found" },
      { status: 404 }
    );
  }
}
