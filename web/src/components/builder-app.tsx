"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { Catalog, DestPiece, DumpInfo, PatternRow } from "@/lib/types";
import { DEST_BASE_PATH } from "@/lib/types";

const EMPTY_DEST: Catalog = {
  file: "Baked empty",
  messages: 0,
  sample_slots_used: 0,
  patterns: [],
  kits: [],
};

function destLabel(i: number): string {
  const bank = String.fromCharCode(65 + Math.floor(i / 16));
  const slot = (i % 16) + 1;
  return `${bank}${String(slot).padStart(2, "0")}`;
}

type Held = {
  dumpPath: string;
  dumpName: string;
  pattern: PatternRow;
};

type DragPayload =
  | ({ kind: "catalog" } & Held)
  | { kind: "dest"; destIndex: number };

function matchesBase(piece: DestPiece, index: number) {
  return piece.origin === "base" && piece.originIndex === index;
}

function cellDiffers(
  index: number,
  piece: DestPiece | undefined,
  base: PatternRow | undefined
) {
  if (!piece && !base) return false;
  if (piece && matchesBase(piece, index)) return false;
  return true;
}

function silk(text: string) {
  return (
    <span className="text-[10px] font-medium tracking-[0.28em] text-muted-foreground uppercase">
      {text}
    </span>
  );
}

function kindBadge(kind: DumpInfo["kind"]) {
  if (kind === "composed") {
    return (
      <Badge variant="outline" className="rounded-[2px] tracking-wide">
        composed
      </Badge>
    );
  }
  return <Badge className="rounded-[2px] tracking-wide">library</Badge>;
}

export function BuilderApp() {
  const [dumps, setDumps] = useState<DumpInfo[]>([]);
  const [templateKind, setTemplateKind] = useState<"baked" | "custom">("baked");
  const [templateName, setTemplateName] = useState("Baked empty");
  const [listError, setListError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [importing, setImporting] = useState(false);
  const [sourceDrag, setSourceDrag] = useState(false);
  const [baseDrag, setBaseDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const baseInput = useRef<HTMLInputElement>(null);

  const [selected, setSelected] = useState<DumpInfo | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  const [pieces, setPieces] = useState<DestPiece[]>([]);
  const [destCatalog, setDestCatalog] = useState<Catalog | null>(EMPTY_DEST);
  const [loadingDest, setLoadingDest] = useState(false);
  const [destError, setDestError] = useState<string | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [outName, setOutName] = useState("Fresh_from_picks");
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeReport, setComposeReport] = useState<string | null>(null);
  const pickSeq = useRef(0);
  const skipCellClick = useRef(false);

  const byDest = useMemo(() => {
    const m = new Map<number, DestPiece>();
    for (const p of pieces) m.set(p.destIndex, p);
    return m;
  }, [pieces]);

  const baseByIndex = useMemo(() => {
    const m = new Map<number, PatternRow>();
    for (const p of destCatalog?.patterns ?? []) m.set(p.index, p);
    return m;
  }, [destCatalog]);

  const applyDestTemplate = useCallback(
    (data: { kind?: string; name?: string; catalog?: Catalog }) => {
      const kind = data.kind === "custom" ? "custom" : "baked";
      const catalog = data.catalog ?? EMPTY_DEST;
      const name = data.name || (kind === "custom" ? "Dropped dest base" : "Baked empty");
      setTemplateKind(kind);
      setTemplateName(name);
      setDestCatalog(catalog);
      setDestError(null);
      setPieces(
        catalog.patterns.map((p) => ({
          id: `base:${p.index}`,
          origin: "base" as const,
          dumpPath: DEST_BASE_PATH,
          dumpName: name.replace(/\.syx$/i, ""),
          pattern: p,
          destIndex: p.index,
          originIndex: p.index,
        }))
      );
    },
    []
  );

  const loadDestCatalog = useCallback(async () => {
    setLoadingDest(true);
    setDestError(null);
    try {
      const res = await fetch("/api/catalog?dest=1");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "could not catalog dest base");
      applyDestTemplate(data);
    } catch (e) {
      setDestError(e instanceof Error ? e.message : "could not catalog dest base");
    } finally {
      setLoadingDest(false);
    }
  }, [applyDestTemplate]);

  const loadDumps = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch("/api/dumps");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "could not list library");
      setDumps(data.dumps);
      if (data.template?.kind) setTemplateKind(data.template.kind);
      if (data.template?.name) setTemplateName(data.template.name);
      const firstLib = (data.dumps as DumpInfo[]).find((d) => d.kind === "library");
      setSelected((prev) => {
        if (prev && (data.dumps as DumpInfo[]).some((d) => d.name === prev.name)) {
          return prev;
        }
        return firstLib ?? (data.dumps as DumpInfo[])[0] ?? null;
      });
    } catch (e) {
      setListError(e instanceof Error ? e.message : "could not list library");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const importSyx = async (files: File[], into: "library" | "template") => {
    const syx = files.filter((f) => f.name.toLowerCase().endsWith(".syx"));
    if (syx.length === 0) {
      setListError("Drop .syx whole-project dumps.");
      return;
    }
    setImporting(true);
    setListError(null);
    try {
      if (into === "template") {
        const first = syx[0];
        if (!first) return;
        setLoadingDest(true);
        const fd = new FormData();
        fd.append("file", first, first.name);
        const res = await fetch("/api/template", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "could not set dest base");
        applyDestTemplate(data);
      } else {
        const fd = new FormData();
        for (const f of syx) fd.append("files", f, f.name);
        const res = await fetch("/api/library", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "could not import");
        await loadDumps();
        if (data.skipped?.length) {
          setListError(data.skipped.join("; "));
        }
      }
    } catch (e) {
      setListError(e instanceof Error ? e.message : "import failed");
    } finally {
      setImporting(false);
      if (into === "template") setLoadingDest(false);
    }
  };

  const resetTemplate = async () => {
    const res = await fetch("/api/template", { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setComposeError(data.error || "could not reset dest base");
      return;
    }
    applyDestTemplate(data);
  };

  useEffect(() => {
    void loadDumps();
  }, [loadDumps]);

  useEffect(() => {
    void loadDestCatalog();
  }, [loadDestCatalog]);

  useEffect(() => {
    if (!selected) {
      setCatalog(null);
      return;
    }
    let cancelled = false;
    setLoadingCatalog(true);
    setCatalogError(null);
    setCatalog(null);
    fetch(`/api/catalog?name=${encodeURIComponent(selected.name)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "catalog failed");
        if (!cancelled) setCatalog(data);
      })
      .catch((e) => {
        if (!cancelled) setCatalogError(e instanceof Error ? e.message : "catalog failed");
      })
      .finally(() => {
        if (!cancelled) setLoadingCatalog(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const placedCount = (dumpPath: string, label: string) =>
    pieces.filter((p) => p.dumpPath === dumpPath && p.pattern.label === label).length;

  const holdFromCatalog = (pattern: PatternRow) => {
    if (!selected) return;
    setHeld({
      dumpPath: selected.name,
      dumpName: selected.name.replace(/\.syx$/i, ""),
      pattern,
    });
    setComposeReport(null);
    setComposeError(null);
  };

  const rearrangeDest = (from: number, to: number) => {
    if (from === to) return;
    setPieces((prev) => {
      const moving = prev.find((p) => p.destIndex === from);
      if (!moving) return prev;
      const target = prev.find((p) => p.destIndex === to);
      if (!target) {
        return prev.map((p) => (p.destIndex === from ? { ...p, destIndex: to } : p));
      }
      return prev.map((p) => {
        if (p.destIndex === from) return { ...p, destIndex: to };
        if (p.destIndex === to) return { ...p, destIndex: from };
        return p;
      });
    });
    setHeld(null);
    setSelectedCell(to);
    setComposeReport(null);
    setComposeError(null);
  };

  const placeHeldAt = (destIndex: number, piece?: Held) => {
    const src = piece ?? held;
    if (!src) {
      setSelectedCell(destIndex);
      return;
    }
    if (byDest.has(destIndex)) {
      setSelectedCell(destIndex);
      setComposeError(
        `dest ${destLabel(destIndex)} is occupied — drop on empty, or drag dest cells to swap`
      );
      return;
    }
    pickSeq.current += 1;
    const next: DestPiece = {
      id: `${src.dumpPath}:${src.pattern.label}:${pickSeq.current}`,
      origin: "library",
      dumpPath: src.dumpPath,
      dumpName: src.dumpName,
      pattern: src.pattern,
      destIndex,
      originIndex: src.pattern.index,
    };
    setPieces((prev) => [...prev.filter((p) => p.destIndex !== destIndex), next]);
    setHeld(null);
    setSelectedCell(destIndex);
    setComposeReport(null);
    setComposeError(null);
  };

  const moveOrSelectCell = (destIndex: number) => {
    if (skipCellClick.current) {
      skipCellClick.current = false;
      setSelectedCell(destIndex);
      return;
    }
    if (held) {
      placeHeldAt(destIndex);
      return;
    }
    if (selectedCell !== null && selectedCell !== destIndex && byDest.has(selectedCell)) {
      rearrangeDest(selectedCell, destIndex);
      return;
    }
    setSelectedCell(destIndex);
  };

  const clearCell = (destIndex: number) => {
    setPieces((prev) => prev.filter((p) => p.destIndex !== destIndex));
    if (selectedCell === destIndex) setSelectedCell(null);
    setComposeReport(null);
    setComposeError(null);
  };

  const sampleEstimate = useMemo(
    () => pieces.reduce((n, p) => n + p.pattern.sample_refs, 0),
    [pieces]
  );

  const diff = useMemo(() => {
    const copies: { path: string; pattern: string; dest: string }[] = [];
    const vacates: string[] = [];
    for (let i = 0; i < 128; i++) {
      const piece = byDest.get(i);
      const base = baseByIndex.get(i);
      if (!cellDiffers(i, piece, base)) continue;
      if (base) vacates.push(destLabel(i));
      if (piece) {
        copies.push({
          path: piece.origin === "base" ? DEST_BASE_PATH : piece.dumpPath,
          pattern: piece.pattern.label,
          dest: destLabel(i),
        });
      }
    }
    return { copies, vacates };
  }, [byDest, baseByIndex]);

  const exportFresh = async (mode: "project" | "edits") => {
    if (!templateKind) {
      setComposeError("Baked empty template is missing.");
      return;
    }
    if (diff.copies.length === 0 && diff.vacates.length === 0) {
      setComposeError("Nothing differs from dest base — rearrange or place a pattern first.");
      return;
    }
    setComposing(true);
    setComposeError(null);
    setComposeReport(null);
    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: templateKind,
          name: outName,
          mode,
          copies: diff.copies,
          vacates: diff.vacates,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "compose failed");
      setComposeReport(data.text);
      if (data.out) {
        const fileRes = await fetch(`/api/exports/${encodeURIComponent(data.out)}`);
        if (!fileRes.ok) {
          throw new Error("composed, but download failed — pick a new name and retry");
        }
        const blob = await fileRes.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = data.out as string;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      await loadDumps();
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : "compose failed");
    } finally {
      setComposing(false);
    }
  };

  const selectedPiece = selectedCell !== null ? byDest.get(selectedCell) : undefined;
  const selectedVacated =
    selectedCell !== null && !selectedPiece && baseByIndex.has(selectedCell);
  const destOccupiedCount = pieces.length;
  const diffCount = useMemo(() => {
    let n = 0;
    for (let i = 0; i < 128; i++) {
      if (cellDiffers(i, byDest.get(i), baseByIndex.get(i))) n++;
    }
    return n;
  }, [byDest, baseByIndex]);

  return (
    <div className="flex min-h-full flex-col bg-background">
      <header className="border-b border-border px-4 py-4 md:px-6">
        <p className="text-[11px] tracking-[0.32em] text-primary uppercase">
          rytm-builder
        </p>
        <h1 className="mt-1 font-heading text-xl font-semibold tracking-tight md:text-2xl">
          Browse dumps. Place on the grid. Export a new project.
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Composer, not an editor. Drag dest cells to rearrange (vacate or swap).
          Grey still matches dest base; red is the project differential. Pattern+kit
          copy only — no kit-only, no live send. Settings-first so samples bind on
          the box. Restore into disposable RAM; +Drive already holds the files.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-card px-4 py-2 font-sans text-[11px] tracking-[0.18em] uppercase md:px-6">
        <span>
          {silk("PAT")}{" "}
          <span className="tracking-normal text-foreground">
            {destOccupiedCount}/128
          </span>
        </span>
        <span>
          {silk("KIT")}{" "}
          <span className="tracking-normal text-foreground">
            {destOccupiedCount}/128
          </span>
        </span>
        <span>
          {silk("SMP")}{" "}
          <span className="tracking-normal text-foreground">
            ~{Math.min(sampleEstimate, 128)}/128
          </span>
        </span>
        <span>
          {silk("DIFF")}{" "}
          <span className="tracking-normal text-foreground">{diffCount}</span>
        </span>
        <span className="text-primary">settings-first</span>
        <span className="min-w-0 flex-1 truncate tracking-normal text-muted-foreground normal-case">
          {held
            ? `held ${held.dumpName} ${held.pattern.label} ${held.pattern.kit_name || ""} → empty dest cell`
            : selectedPiece && selectedCell !== null
              ? `${destLabel(selectedPiece.destIndex)} ← ${selectedPiece.dumpName} ${selectedPiece.pattern.label}${
                  cellDiffers(
                    selectedCell,
                    selectedPiece,
                    baseByIndex.get(selectedCell)
                  )
                    ? " · red vs dest base"
                    : " · matches dest base"
                }`
              : selectedVacated && selectedCell !== null
                ? `${destLabel(selectedCell)} vacated vs dest base (red)`
                : "drag dest cells to rearrange · grey matches dest base · red is the diff"}
        </span>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1.4fr)] md:p-4">
        <Card
          onDragOver={(e) => {
            e.preventDefault();
            setSourceDrag(true);
          }}
          onDragLeave={() => setSourceDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setSourceDrag(false);
            void importSyx(Array.from(e.dataTransfer.files), "library");
          }}
          className={sourceDrag ? "border-primary" : ""}
        >
          <CardHeader className="border-b">
            <CardTitle className="text-[10px] tracking-[0.28em] uppercase">
              Source
            </CardTitle>
            <CardDescription className="text-xs">
              Drop .syx dumps here. {dumps.length} in library.
              {importing ? " Importing…" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 pt-3">
            <input
              ref={fileInput}
              type="file"
              accept=".syx"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = e.target.files;
                if (list) void importSyx(Array.from(list), "library");
                e.target.value = "";
              }}
            />
            {loadingList && (
              <p className="text-sm text-muted-foreground">Listing library…</p>
            )}
            {listError && (
              <p className="text-sm text-destructive">{listError}</p>
            )}
            {!loadingList && dumps.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Library is empty. Drop Analog Rytm whole-project .syx files, or{" "}
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => fileInput.current?.click()}
                >
                  choose files
                </button>
                .
              </p>
            )}
            {dumps.length > 0 && (
              <button
                type="button"
                className="mb-2 text-xs text-muted-foreground underline"
                onClick={() => fileInput.current?.click()}
              >
                Add more .syx
              </button>
            )}
            <ScrollArea className="h-[min(48vh,380px)]">
              <ul className="flex flex-col gap-px pr-2">
                {dumps.map((d) => {
                  const active = selected?.name === d.name;
                  return (
                    <li key={d.name}>
                      <button
                        type="button"
                        onClick={() => setSelected(d)}
                        className={`flex w-full flex-col gap-0.5 rounded-[2px] px-2 py-1.5 text-left text-sm ${
                          active
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-muted"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium">{d.name}</span>
                          {kindBadge(d.kind)}
                        </span>
                        <span
                          className={`text-xs ${
                            active ? "opacity-80" : "text-muted-foreground"
                          }`}
                        >
                          {(d.bytes / 1_000_000).toFixed(2)} MB
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-[10px] tracking-[0.28em] uppercase">
              {selected ? `Kit / Pat  ${selected.name.replace(/\.syx$/i, "")}` : "Kit / Pat"}
            </CardTitle>
            <CardDescription>
              {catalog
                ? `${catalog.patterns.length} nonempty · ${catalog.sample_slots_used}/128 sample slots`
                : "Select a dump to catalog it."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 pt-3">
            {loadingCatalog && (
              <p className="text-sm text-muted-foreground">
                Decoding whole project… (a few seconds)
              </p>
            )}
            {catalogError && (
              <p className="text-sm text-destructive">{catalogError}</p>
            )}
            {!selected && !loadingCatalog && (
              <p className="text-sm text-muted-foreground">
                Pick a library dump on the left.
              </p>
            )}
            {catalog && catalog.patterns.length === 0 && !loadingCatalog && (
              <p className="text-sm text-muted-foreground">
                No nonempty patterns. Empty templates are the compose base.
              </p>
            )}
            <ScrollArea className="h-[min(48vh,380px)]">
              <ul className="flex flex-col gap-px pr-2">
                {catalog?.patterns.map((p) => {
                  const n = selected ? placedCount(selected.path, p.label) : 0;
                  const isHeld =
                    held?.dumpPath === selected?.path &&
                    held?.pattern.label === p.label;
                  return (
                    <li
                      key={p.label}
                      draggable={p.kit !== null}
                      onDragStart={(e) => {
                        if (!selected || p.kit === null) return;
                        e.dataTransfer.setData(
                          "application/json",
                          JSON.stringify({
                            kind: "catalog",
                            dumpPath: selected.name,
                            dumpName: selected.name.replace(/\.syx$/i, ""),
                            pattern: p,
                          } satisfies DragPayload)
                        );
                        holdFromCatalog(p);
                      }}
                      className={`flex items-center justify-between gap-2 rounded-[2px] px-2 py-1.5 ${
                        isHeld ? "bg-primary/20" : "hover:bg-muted/60"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-medium">{p.label}</span>
                          <span className="truncate">
                            {p.kit_name || "unnamed kit"}
                            {p.kit !== null ? (
                              <span className="text-muted-foreground">
                                {" "}
                                · kit {p.kit}
                              </span>
                            ) : (
                              <span className="text-destructive"> · unsaved kit</span>
                            )}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {p.trigs} trigs · {p.sample_refs} sample refs
                          {p.smp_nr_plocks > 0
                            ? ` · ${p.smp_nr_plocks} SMP_NR plocks`
                            : ""}
                          {n > 0 ? ` · on grid ×${n}` : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={isHeld ? "default" : n > 0 ? "secondary" : "outline"}
                        disabled={p.kit === null}
                        onClick={() => holdFromCatalog(p)}
                      >
                        {isHeld ? "held" : "add"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setBaseDrag(true);
            }
          }}
          onDragLeave={() => setBaseDrag(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setBaseDrag(false);
            void importSyx(Array.from(e.dataTransfer.files), "template");
          }}
          className={baseDrag ? "border-primary" : ""}
        >
          <CardHeader className="border-b">
            <CardTitle className="text-[10px] tracking-[0.28em] uppercase">
              Pat dest
            </CardTitle>
            <CardDescription>
              Drag occupied cells to rearrange (swap if target is full). Grey =
              matches dest base. Red = differs (new, moved, or vacated). Base:{" "}
              {templateName}
              {templateKind === "custom" ? " (override)" : ""}
              {diffCount > 0 ? ` · ${diffCount} red` : ""}
              . New file only.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3 pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <input
                ref={baseInput}
                type="file"
                accept=".syx"
                className="hidden"
                onChange={(e) => {
                  const list = e.target.files;
                  if (list) void importSyx(Array.from(list), "template");
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="underline"
                onClick={() => baseInput.current?.click()}
              >
                Drop or choose a .syx dest base
              </button>
              {templateKind === "custom" && (
                <button type="button" className="underline" onClick={() => void resetTemplate()}>
                  Reset to baked empty
                </button>
              )}
              {loadingDest && <span>Cataloging dest base…</span>}
            </div>
            {destError && <p className="text-sm text-destructive">{destError}</p>}
            <div className="overflow-x-auto">
              <div
                className="grid gap-px"
                style={{
                  gridTemplateColumns: "1.4rem repeat(16, minmax(1.1rem, 1fr))",
                }}
              >
                <div />
                {Array.from({ length: 16 }, (_, s) => (
                  <div
                    key={s}
                    className="pb-1 text-center text-[9px] tracking-wide text-muted-foreground"
                  >
                    {String(s + 1).padStart(2, "0")}
                  </div>
                ))}
                {Array.from({ length: 8 }, (_, bank) => (
                  <BankRow
                    key={bank}
                    bank={bank}
                    byDest={byDest}
                    baseByIndex={baseByIndex}
                    selectedCell={selectedCell}
                    held={held}
                    onCell={(i) => moveOrSelectCell(i)}
                    onDestDragEnd={() => {
                      skipCellClick.current = true;
                      window.setTimeout(() => {
                        skipCellClick.current = false;
                      }, 50);
                    }}
                    onDropPayload={(i, payload) => {
                      if (payload.kind === "dest") rearrangeDest(payload.destIndex, i);
                      else placeHeldAt(i, payload);
                    }}
                  />
                ))}
              </div>
            </div>
            {selectedPiece && (
              <div className="flex items-start justify-between gap-2 border border-border bg-muted px-2 py-2 text-xs">
                <p>
                  {destLabel(selectedPiece.destIndex)} ← {selectedPiece.dumpName}{" "}
                  {selectedPiece.pattern.label} · {selectedPiece.pattern.kit_name || "unnamed"}
                  {selectedPiece.origin === "base" &&
                  selectedCell !== null &&
                  matchesBase(selectedPiece, selectedCell)
                    ? " · grey dest base"
                    : " · red vs dest base"}
                </p>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => clearCell(selectedPiece.destIndex)}
                >
                  clear
                </Button>
              </div>
            )}
            {selectedVacated && selectedCell !== null && (
              <div className="border border-primary bg-primary/15 px-2 py-2 text-xs">
                <p>
                  {destLabel(selectedCell)} vacated vs dest base (red empty). Drag
                  something here or leave empty.
                </p>
              </div>
            )}
            <label className="text-sm">
              New file name
              <Input
                className="mt-1 rounded-[2px] font-sans"
                value={outName}
                onChange={(e) => setOutName(e.target.value)}
                placeholder="Fresh_from_picks"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Downloads a .syx. This app never talks to the Rytm — receive the
              file in your sysex editor. Project = whole dump into empty RAM.
              Edits = red cells only onto dest-base already in RAM. Pattern+kit
              together.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="rounded-[2px] flex-1"
                onClick={() => void exportFresh("project")}
                disabled={composing || diffCount === 0}
              >
                {composing ? "Composing…" : "Download project .syx"}
              </Button>
              <Button
                className="rounded-[2px] flex-1"
                variant="secondary"
                onClick={() => void exportFresh("edits")}
                disabled={composing || diffCount === 0}
              >
                {composing ? "Composing…" : "Download edits .syx"}
              </Button>
            </div>
            {composeError && (
              <p className="text-sm text-destructive">{composeError}</p>
            )}
            {composeReport && (
              <Textarea
                readOnly
                className="min-h-40 rounded-[2px] font-sans text-xs"
                value={composeReport}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BankRow({
  bank,
  byDest,
  baseByIndex,
  selectedCell,
  held,
  onCell,
  onDestDragEnd,
  onDropPayload,
}: {
  bank: number;
  byDest: Map<number, DestPiece>;
  baseByIndex: Map<number, PatternRow>;
  selectedCell: number | null;
  held: Held | null;
  onCell: (i: number) => void;
  onDestDragEnd: () => void;
  onDropPayload: (i: number, payload: DragPayload) => void;
}) {
  const letter = String.fromCharCode(65 + bank);
  return (
    <>
      <div className="flex items-center text-[10px] tracking-[0.2em] text-muted-foreground">
        {letter}
      </div>
      {Array.from({ length: 16 }, (_, s) => {
        const i = bank * 16 + s;
        const piece = byDest.get(i);
        const base = baseByIndex.get(i);
        const selected = selectedCell === i;
        const differs = cellDiffers(i, piece, base);
        const vacated = !piece && !!base;
        const title = piece
          ? `${destLabel(i)} ← ${piece.dumpName} ${piece.pattern.label}${
              differs ? " · red vs dest base" : " · matches dest base"
            }`
          : vacated
            ? `${destLabel(i)} vacated vs dest base`
            : `${destLabel(i)} empty`;
        const label = piece
          ? (piece.pattern.kit_name || piece.pattern.label).slice(0, 3)
          : "";
        const tone = piece
          ? differs
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground bg-secondary text-foreground"
          : vacated
            ? "border-primary bg-primary/35 text-primary-foreground"
            : "border-border bg-background text-muted-foreground";
        return (
          <button
            key={i}
            type="button"
            draggable={!!piece}
            title={title}
            onClick={() => onCell(i)}
            onDragStart={(e) => {
              if (!piece) return;
              e.dataTransfer.setData(
                "application/json",
                JSON.stringify({ kind: "dest", destIndex: i } satisfies DragPayload)
              );
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => onDestDragEnd()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const raw = e.dataTransfer.getData("application/json");
              if (!raw) {
                if (held) onDropPayload(i, { kind: "catalog", ...held });
                return;
              }
              try {
                const parsed = JSON.parse(raw) as DragPayload | Held;
                if ("kind" in parsed && (parsed.kind === "dest" || parsed.kind === "catalog")) {
                  onDropPayload(i, parsed);
                } else {
                  const legacy = parsed as Held;
                  onDropPayload(i, { kind: "catalog", ...legacy });
                }
              } catch {
                if (held) onDropPayload(i, { kind: "catalog", ...held });
              }
            }}
            className={`aspect-square min-h-[1.15rem] rounded-[2px] border text-[8px] leading-none ${tone} ${
              selected ? "outline outline-1 outline-offset-1 outline-white" : ""
            } ${held && !piece ? "hover:border-primary" : ""}`}
          >
            {label}
          </button>
        );
      })}
    </>
  );
}
