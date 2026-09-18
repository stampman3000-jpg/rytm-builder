"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { Catalog, DumpInfo, PickRow } from "@/lib/types";

function destLabel(i: number): string {
  const bank = String.fromCharCode(65 + Math.floor(i / 16));
  const slot = (i % 16) + 1;
  return `${bank}${String(slot).padStart(2, "0")}`;
}

function kindBadge(kind: DumpInfo["kind"]) {
  if (kind === "template") {
    return (
      <Badge variant="secondary" className="rounded-sm tracking-wide">
        empty template
      </Badge>
    );
  }
  if (kind === "composed") {
    return (
      <Badge variant="outline" className="rounded-sm tracking-wide">
        composed
      </Badge>
    );
  }
  return (
    <Badge className="rounded-sm tracking-wide">library</Badge>
  );
}

export function BuilderApp() {
  const [dumps, setDumps] = useState<DumpInfo[]>([]);
  const [dumpsDir, setDumpsDir] = useState<string>("");
  const [template, setTemplate] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  const [selected, setSelected] = useState<DumpInfo | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  const [picks, setPicks] = useState<PickRow[]>([]);
  const [outName, setOutName] = useState("Fresh_from_picks");
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeReport, setComposeReport] = useState<string | null>(null);
  const pickSeq = useRef(0);
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const loadDumps = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch("/api/dumps");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "could not list dumps");
      setDumps(data.dumps);
      setDumpsDir(data.dir);
      setTemplate(data.template);
      const firstLib = (data.dumps as DumpInfo[]).find((d) => d.kind === "library");
      setSelected((prev) => {
        if (prev && (data.dumps as DumpInfo[]).some((d) => d.path === prev.path)) {
          return prev;
        }
        return firstLib ?? null;
      });
    } catch (e) {
      setListError(e instanceof Error ? e.message : "could not list dumps");
    } finally {
      setLoadingList(false);
    }
  }, []);

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
    fetch(`/api/catalog?path=${encodeURIComponent(selected.path)}`)
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

  const queuedCount = (dumpPath: string, label: string) =>
    picks.filter((p) => p.dumpPath === dumpPath && p.pattern.label === label)
      .length;

  const addPick = (pattern: NonNullable<Catalog>["patterns"][number]) => {
    if (!selected) return;
    pickSeq.current += 1;
    const id = `${selected.path}:${pattern.label}:${pickSeq.current}`;
    setPicks((prev) => [
      ...prev,
      {
        id,
        dumpPath: selected.path,
        dumpName: selected.name.replace(/\.syx$/i, ""),
        pattern,
      },
    ]);
    setComposeReport(null);
    setComposeError(null);
  };

  const removePick = (id: string) => {
    setPicks((prev) => prev.filter((p) => p.id !== id));
    setComposeReport(null);
  };

  const movePick = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    setPicks((prev) => {
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[index];
      next[index] = next[j];
      next[j] = tmp;
      return next;
    });
    setComposeReport(null);
  };

  const reorderPick = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setPicks((prev) => {
      if (from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setComposeReport(null);
  };

  const sampleEstimate = useMemo(
    () => picks.reduce((n, p) => n + p.pattern.sample_refs, 0),
    [picks]
  );

  const exportFresh = async () => {
    if (!template) {
      setComposeError("No empty template in the dumps folder (need Untitled-4.syx).");
      return;
    }
    if (picks.length === 0) {
      setComposeError("Add at least one pattern.");
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
          template,
          name: outName,
          copies: picks.map((p) => ({
            path: p.dumpPath,
            pattern: p.pattern.label,
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

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border px-4 py-5 md:px-6">
        <p className="font-sans text-[11px] tracking-[0.32em] text-primary uppercase">
          rytm-builder
        </p>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight md:text-[1.75rem]">
          Browse dumps. Pick patterns. Export a new project.
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          This is a composer, not an editor. Originals stay untouched. The new
          file is settings-first so samples bind on the box. Restore into an
          empty or disposable Analog Rytm project; samples must already be on
          +Drive. If it sounds wrong, delete that RAM project — don&apos;t save.
        </p>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-3 md:p-6">
        <Card className="min-h-[280px] rounded-md">
          <CardHeader className="border-b">
            <CardTitle className="font-heading text-xs tracking-[0.18em] uppercase">
              Source dumps
            </CardTitle>
            <CardDescription className="font-sans text-xs break-all">
              {dumpsDir || "looking for dumps folder…"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 pt-3">
            {loadingList && (
              <p className="text-sm text-muted-foreground">Listing .syx files…</p>
            )}
            {listError && (
              <p className="text-sm text-destructive">{listError}</p>
            )}
            {!loadingList && !listError && dumps.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No .syx files in that folder. Put Untitled.syx, Untitled-1.syx,
                and Untitled-4.syx there.
              </p>
            )}
            <ScrollArea className="h-[min(52vh,420px)]">
              <ul className="flex flex-col gap-1 pr-2">
                {dumps.map((d) => {
                  const active = selected?.path === d.path;
                  return (
                    <li key={d.path}>
                      <button
                        type="button"
                        onClick={() => setSelected(d)}
                        className={`flex w-full flex-col gap-1 rounded-md px-3 py-2 text-left text-sm transition-colors ${
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
                          className={`font-sans text-xs ${
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

        <Card className="min-h-[280px] rounded-md">
          <CardHeader className="border-b">
            <CardTitle className="font-heading text-xs tracking-[0.18em] uppercase">
              {selected ? selected.name.replace(/\.syx$/i, "") : "Patterns"}
            </CardTitle>
            <CardDescription>
              {catalog
                ? `${catalog.patterns.length} nonempty · ${catalog.sample_slots_used}/128 sample slots · kit name + sample-ref count, no sample names`
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
                No nonempty patterns. Empty templates stay on the left as the
                compose base — don&apos;t pick from them.
              </p>
            )}
            <ScrollArea className="h-[min(52vh,420px)]">
              <ul className="flex flex-col gap-1 pr-2">
                {catalog?.patterns.map((p) => {
                  const n =
                    selected ? queuedCount(selected.path, p.label) : 0;
                  return (
                    <li
                      key={p.label}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-2 font-sans">
                          <span className="font-sans font-medium">{p.label}</span>
                          <span className="truncate font-sans">
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
                        <p className="font-sans text-xs text-muted-foreground">
                          {p.trigs} trigs · {p.sample_refs} sample refs
                          {p.smp_nr_plocks > 0
                            ? ` · ${p.smp_nr_plocks} SMP_NR plocks`
                            : ""}
                          {n > 0 ? ` · queued ×${n}` : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={n > 0 ? "secondary" : "default"}
                        disabled={p.kit === null}
                        onClick={() => addPick(p)}
                      >
                        {n > 0 ? "add again" : "add"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="min-h-[280px] rounded-md">
          <CardHeader className="border-b">
            <CardTitle className="font-heading text-xs tracking-[0.18em] uppercase">
              Fresh project
            </CardTitle>
            <CardDescription>
              Dest slots follow this list: A01, A02, … Shuffle with arrows or
              drag. Same pattern from the same dump can appear more than once.
              Template {template ? template.split("/").pop() : "missing"}.
              Never overwrites an existing file.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3 pt-3">
            {picks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing queued. Add patterns from one or more dumps. Add the
                same one twice if you want it in two dest slots.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {picks.map((p, i) => (
                  <li
                    key={p.id}
                    draggable
                    onDragStart={(e) => {
                      const t = e.target as HTMLElement;
                      if (t.closest("button")) {
                        e.preventDefault();
                        return;
                      }
                      dragFrom.current = i;
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(i);
                    }}
                    onDragLeave={() => {
                      setDragOver((cur) => (cur === i ? null : cur));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = dragFrom.current;
                      if (from !== null) reorderPick(from, i);
                      dragFrom.current = null;
                      setDragOver(null);
                    }}
                    onDragEnd={() => {
                      dragFrom.current = null;
                      setDragOver(null);
                    }}
                    className={`flex items-start justify-between gap-2 rounded-md px-2 py-2 ${
                      dragOver === i
                        ? "bg-primary/15 ring-1 ring-primary/50"
                        : "bg-muted/50"
                    }`}
                  >
                    <div className="flex min-w-0 items-start gap-1">
                      <span
                        className="mt-0.5 cursor-grab text-muted-foreground active:cursor-grabbing"
                        title="Drag to reorder"
                        aria-hidden
                      >
                        <GripVertical className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-sans text-sm">
                          {destLabel(i)} ← {p.dumpName} {p.pattern.label}
                        </p>
                        <p className="font-sans text-xs text-muted-foreground">
                          {p.pattern.kit_name || "unnamed"} ·{" "}
                          {p.pattern.sample_refs} sample refs
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Move ${destLabel(i)} up`}
                        disabled={i === 0}
                        onClick={() => movePick(i, -1)}
                      >
                        <ChevronUp />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Move ${destLabel(i)} down`}
                        disabled={i === picks.length - 1}
                        onClick={() => movePick(i, 1)}
                      >
                        <ChevronDown />
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => removePick(p.id)}
                      >
                        remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Rough sample-slot sum {sampleEstimate} (reuse may lower this; ceiling
              is 128).
            </p>
            <Separator />
            <label className="text-sm">
              New file name
              <Input
                className="mt-1 rounded-md font-sans"
                value={outName}
                onChange={(e) => setOutName(e.target.value)}
                placeholder="Fresh_from_picks"
              />
            </label>
            <Button
              className="rounded-md"
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
                className="min-h-40 font-sans text-xs"
                value={composeReport}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
