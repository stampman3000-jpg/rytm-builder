import { NextResponse } from "next/server";
import { resolveLibraryFile, runBuilder } from "@/lib/rytm";
import type { Catalog } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const dump = url.searchParams.get("name") || url.searchParams.get("path");
  if (!dump) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    const resolved = resolveLibraryFile(dump);
    const { stdout } = await runBuilder(["catalog", "--json", resolved]);
    const catalog = JSON.parse(stdout) as Catalog;
    return NextResponse.json(catalog);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "catalog failed" },
      { status: 500 }
    );
  }
}
