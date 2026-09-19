export type PatternRow = {
  label: string;
  index: number;
  kit: number | null;
  kit_name: string;
  trigs: number;
  sample_refs: number;
  smp_nr_plocks: number;
};

export type KitRow = {
  index: number;
  name: string;
  sample_refs: number;
  sample_nrs: number[];
};

export type Catalog = {
  file: string;
  messages: number;
  sample_slots_used: number;
  patterns: PatternRow[];
  kits: KitRow[];
};

export type DumpInfo = {
  name: string;
  path: string;
  bytes: number;
  kind: "library" | "composed";
};

export type PickRow = {
  id: string;
  dumpPath: string;
  dumpName: string;
  pattern: PatternRow;
  destIndex: number;
};

/** Working dest-grid occupant. `origin: "base"` is dest-base dump content. */
export type DestPiece = {
  id: string;
  origin: "base" | "library";
  dumpPath: string;
  dumpName: string;
  pattern: PatternRow;
  destIndex: number;
  originIndex: number;
};

/** Kit dest-grid occupant. Same A01–H16 labels as kit indices 0–127. */
export type DestKitPiece = {
  id: string;
  origin: "base" | "library";
  dumpPath: string;
  dumpName: string;
  kit: KitRow;
  destIndex: number;
  originIndex: number;
};

export const DEST_BASE_PATH = "@dest";
