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
import type { Catalog, DumpInfo, PatternRow, PickRow } from "@/lib/types";

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

  const [picks, setPicks] = useState<PickRow[]>([]);
  const [held, setHeld] = useState<Held | null>(null);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [outName, setOutName] = useState("Fresh_from_picks");
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeReport, setComposeReport] = useState<string | null>(null);
  const pickSeq = useRef(0);

  const byDest = useMemo(() => {
    const m = new Map<number, PickRow>();
    for (const p of picks) m.set(p.destIndex, p);
    return m;
  }, [picks]);

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
        const fd = new FormData();
        fd.append("file", first, first.name);
        const res = await fetch("/api/template", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "could not set dest base");
        setTemplateKind("custom");
        setTemplateName(data.name || "Dropped dest base");
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
    }
  };

  const resetTemplate = async () => {
    const res = await fetch("/api/template", { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setComposeError(data.error || "could not reset dest base");
      return;
    }
    setTemplateKind("baked");
    setTemplateName(data.name || "Baked empty");
  };

  useEffect(() => {
    void loadDumps();
  }, [loadDumps]);

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
    picks.filter((p) => p.dumpPath === dumpPath && p.pattern.label === label).length;

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

  const placeHeldAt = (destIndex: number, piece?: Held) => {
    const src = piece ?? held;
    if (!src) {
      setSelectedCell(destIndex);
      return;
    }
    pickSeq.current += 1;
    const next: PickRow = {
      id: `${src.dumpPath}:${src.pattern.label}:${pickSeq.current}`,
      dumpPath: src.dumpPath,
      dumpName: src.dumpName,
      pattern: src.pattern,
      destIndex,
    };
    setPicks((prev) => [...prev.filter((p) => p.destIndex !== destIndex), next]);
    setHeld(null);
    setSelectedCell(destIndex);
    setComposeReport(null);
    setComposeError(null);
  };

  const moveOrSelectCell = (destIndex: number) => {
    if (held) {
      placeHeldAt(destIndex);
      return;
    }
    if (selectedCell !== null && selectedCell !== destIndex && byDest.has(selectedCell)) {
      setPicks((prev) => {
        const moving = prev.find((p) => p.destIndex === selectedCell);
        if (!moving) return prev;
        return [
          ...prev.filter(
            (p) => p.destIndex !== selectedCell && p.destIndex !== destIndex
          ),
          { ...moving, destIndex },
        ];
      });
      setSelectedCell(destIndex);
      setComposeReport(null);
      return;
    }
    setSelectedCell(destIndex);
  };

  const clearCell = (destIndex: number) => {
    setPicks((prev) => prev.filter((p) => p.destIndex !== destIndex));
    if (selectedCell === destIndex) setSelectedCell(null);
    setComposeReport(null);
  };

  const sampleEstimate = useMemo(
    () => picks.reduce((n, p) => n + p.pattern.sample_refs, 0),
    [picks]
  );

  const exportFresh = async () => {
    if (!templateKind) {
      setComposeError("Baked empty template is missing.");
      return;
    }
    if (picks.length === 0) {
      setComposeError("Place at least one pattern on the dest grid.");
      return;
    }
    setComposing(true);
    setComposeError(null);
    setComposeReport(null);
    try {
      const ordered = [...picks].sort((a, b) => a.destIndex - b.destIndex);
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: templateKind,
          name: outName,
          copies: ordered.map((p) => ({
            path: p.dumpPath,
            pattern: p.pattern.label,
            dest: destLabel(p.destIndex),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "compose failed");
      setComposeReport(data.text);
      await loadDumps();
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : "compose failed");
    } finally {
      setComposing(false);
    }
  };

  const selectedPick = selectedCell !== null ? byDest.get(selectedCell) : undefined;

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
          Composer, not an editor. Empty dest cells stay empty (A01 can be blank).
          Pattern+kit copy only — no kit-only, no live send. Settings-first so
          samples bind on the box. Restore into disposable RAM; +Drive already
          holds the files.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-card px-4 py-2 font-sans text-[11px] tracking-[0.18em] uppercase md:px-6">
        <span>
          {silk("PAT")}{" "}
          <span className="tracking-normal text-foreground">
            {picks.length}/128
          </span>
        </span>
        <span>
          {silk("KIT")}{" "}
          <span className="tracking-normal text-foreground">
            {picks.length}/128
          </span>
        </span>
        <span>
          {silk("SMP")}{" "}
          <span className="tracking-normal text-foreground">
            ~{Math.min(sampleEstimate, 128)}/128
          </span>
        </span>
        <span className="text-primary">settings-first</span>
        <span className="min-w-0 flex-1 truncate tracking-normal text-muted-foreground normal-case">
          {held
            ? `held ${held.dumpName} ${held.pattern.label} ${held.pattern.kit_name || ""} → click a dest cell`
            : selectedPick
              ? `${destLabel(selectedPick.destIndex)} ← ${selectedPick.dumpName} ${selectedPick.pattern.label}`
              : "click ADD then a dest cell (empty cells are first-class)"}
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
                            dumpPath: selected.name,
                            dumpName: selected.name.replace(/\.syx$/i, ""),
                            pattern: p,
                          } satisfies Held)
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
            e.preventDefault();
            setBaseDrag(true);
          }}
          onDragLeave={() => setBaseDrag(false)}
          onDrop={(e) => {
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
              A–H × 1–16. Empty cells stay empty. Base: {templateName}
              {templateKind === "custom" ? " (override)" : ""}. New file only.
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
            </div>
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
                    selectedCell={selectedCell}
                    held={held}
                    onCell={(i) => moveOrSelectCell(i)}
                    onDropHeld={(i, piece) => placeHeldAt(i, piece)}
                  />
                ))}
              </div>
            </div>
            {selectedPick && (
              <div className="flex items-start justify-between gap-2 border border-border bg-muted px-2 py-2 text-xs">
                <p>
                  {destLabel(selectedPick.destIndex)} ← {selectedPick.dumpName}{" "}
                  {selectedPick.pattern.label} · {selectedPick.pattern.kit_name || "unnamed"}
                </p>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => clearCell(selectedPick.destIndex)}
                >
                  clear
                </Button>
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
            <Button
              className="rounded-[2px]"
              onClick={() => void exportFresh()}
              disabled={composing || picks.length === 0}
            >
              {composing ? "Composing…" : "Export new .syx"}
            </Button>
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
  selectedCell,
  held,
  onCell,
  onDropHeld,
}: {
  bank: number;
  byDest: Map<number, PickRow>;
  selectedCell: number | null;
  held: Held | null;
  onCell: (i: number) => void;
  onDropHeld: (i: number, piece: Held) => void;
}) {
  const letter = String.fromCharCode(65 + bank);
  return (
    <>
      <div className="flex items-center text-[10px] tracking-[0.2em] text-muted-foreground">
        {letter}
      </div>
      {Array.from({ length: 16 }, (_, s) => {
        const i = bank * 16 + s;
        const pick = byDest.get(i);
        const selected = selectedCell === i;
        return (
          <button
            key={i}
            type="button"
            title={
              pick
                ? `${destLabel(i)} ← ${pick.dumpName} ${pick.pattern.label}`
                : `${destLabel(i)} empty`
            }
            onClick={() => onCell(i)}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const raw = e.dataTransfer.getData("application/json");
              if (!raw) {
                if (held) onDropHeld(i, held);
                return;
              }
              try {
                onDropHeld(i, JSON.parse(raw) as Held);
              } catch {
                if (held) onDropHeld(i, held);
              }
            }}
            className={`aspect-square min-h-[1.15rem] rounded-[2px] border text-[8px] leading-none ${
              pick
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground"
            } ${selected ? "outline outline-1 outline-offset-1 outline-white" : ""} ${
              held && !pick ? "hover:border-primary" : ""
            }`}
          >
            {pick ? (pick.pattern.kit_name || pick.pattern.label).slice(0, 3) : ""}
          </button>
        );
      })}
    </>
  );
}
