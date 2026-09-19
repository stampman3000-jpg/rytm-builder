import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { Catalog, DumpInfo } from "@/lib/types";

export type TemplateKind = "baked" | "custom";

export type DestTemplate = {
  kind: TemplateKind;
  name: string;
  catalog: Catalog;
};

export type LibraryState = {
  dumps: DumpInfo[];
  template: { kind: TemplateKind; name: string };
};

export type ComposeBody = {
  template: TemplateKind;
  name: string;
  mode: "project" | "edits";
  copies?: { path: string; pattern: string; dest: string }[];
  vacates?: string[];
  kitCopies?: { path: string; kit: string; dest: string }[];
  kitVacates?: string[];
  patternCopies?: { path: string; pattern: string; dest: string }[];
};

export type ComposeOk = {
  out: string;
  report: string;
  mode: string;
  text: string;
  savedAs: string | null;
};

type FilePayload = { name: string; bytes: number[] };

async function filePayload(file: File): Promise<FilePayload> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return { name: file.name, bytes: Array.from(buf) };
}

function asError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === "string") return new Error(e);
  return new Error("request failed");
}

export async function listLibrary(): Promise<LibraryState> {
  try {
    return await invoke<LibraryState>("list_library_cmd");
  } catch (e) {
    throw asError(e);
  }
}

export async function catalogDest(): Promise<DestTemplate> {
  try {
    return await invoke<DestTemplate>("catalog_dest_cmd");
  } catch (e) {
    throw asError(e);
  }
}

export async function catalogDump(name: string): Promise<Catalog> {
  try {
    return await invoke<Catalog>("catalog_dump_cmd", { name });
  } catch (e) {
    throw asError(e);
  }
}

export async function importLibrary(files: File[]): Promise<{
  imported: string[];
  skipped: string[];
}> {
  try {
    const payloads = await Promise.all(files.map(filePayload));
    return await invoke("import_library_cmd", { files: payloads });
  } catch (e) {
    throw asError(e);
  }
}

export async function setDestBase(file: File): Promise<DestTemplate> {
  try {
    return await invoke<DestTemplate>("set_dest_base_cmd", {
      file: await filePayload(file),
    });
  } catch (e) {
    throw asError(e);
  }
}

export async function resetDestBase(): Promise<DestTemplate> {
  try {
    return await invoke<DestTemplate>("reset_dest_base_cmd");
  } catch (e) {
    throw asError(e);
  }
}

export async function composeExport(body: ComposeBody): Promise<ComposeOk> {
  try {
    const data = await invoke<{
      out: string;
      report: string;
      mode: string;
      text: string;
      appPath: string;
      suggestedPath: string;
    }>("compose_export_cmd", { request: body });
    const dest = await save({
      defaultPath: data.suggestedPath,
      filters: [{ name: "SysEx", extensions: ["syx"] }],
    });
    let savedAs: string | null = null;
    if (dest) {
      savedAs = await invoke<string>("save_export_as_cmd", {
        sourceName: data.out,
        dest,
      });
    }
    return {
      out: data.out,
      report: data.report,
      mode: data.mode,
      text: data.text,
      savedAs,
    };
  } catch (e) {
    throw asError(e);
  }
}
