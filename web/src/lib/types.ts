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
  kind: "template" | "library" | "composed";
};

export type PickRow = {
  id: string;
  dumpPath: string;
  dumpName: string;
  pattern: PatternRow;
};
