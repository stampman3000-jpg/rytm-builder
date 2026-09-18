"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  if (kind === "template") return <Badge variant="secondary">empty template</Badge>;
  if (kind === "composed") return <Badge variant="outline">composed</Badge>;
  return <Badge>library</Badge>;
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

  const addPick = (pattern: NonNullable<Catalog>["patterns"][number]) => {
    if (!selected) return;
    const id = `${selected.path}:${pattern.label}`;
    setPicks((prev) => {
      if (prev.some((p) => p.id === id)) return prev;
      return [
        ...prev,
        {
          id,
          dumpPath: selected.path,
          dumpName: selected.name.replace(/\.syx$/i, ""),
          pattern,
        },
      ];
    });
    setComposeReport(null);
    setComposeError(null);
  };

  const removePick = (id: string) => {
    setPicks((prev) => prev.filter((p) => p.id !== id));
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
      <header className="border-b border-border px-4 py-4 md:px-6">
        <p className="font-mono text-xs tracking-[0.2em] text-primary uppercase">
          rytm-builder
        </p>
        <h1 className="mt-1 text-xl font-medium md:text-2xl">
          Browse dumps. Pick patterns. Export a new project.
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          This is a composer, not an editor. Originals stay untouched. The new
          file is settings-first so samples bind on the box. Restore into an
          empty or disposable Analog Rytm project; samples must already be on
          +Drive. If it sounds wrong, delete that RAM project — don&apos;t save.
        </p>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-3 md:p-6">
        <Card className="min-h-[280px]">
          <CardHeader className="border-b">
            <CardTitle>Source dumps</CardTitle>
            <CardDescription className="font-mono text-xs break-all">
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
                        className={`flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
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
                          className={`font-mono text-xs ${
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

        <Card className="min-h-[280px]">
          <CardHeader className="border-b">
            <CardTitle>
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
                  const id = selected ? `${selected.path}:${p.label}` : p.label;
                  const already = picks.some((x) => x.id === id);
                  return (
                    <li
                      key={p.label}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-mono font-medium">{p.label}</span>
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
                        <p className="font-mono text-xs text-muted-foreground">
                          {p.trigs} trigs · {p.sample_refs} sample refs
                          {p.smp_nr_plocks > 0
                            ? ` · ${p.smp_nr_plocks} SMP_NR plocks`
                            : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={already ? "secondary" : "default"}
                        disabled={already || p.kit === null}
                        onClick={() => addPick(p)}
                      >
                        {already ? "added" : "add"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="min-h-[280px]">
          <CardHeader className="border-b">
            <CardTitle>Fresh project</CardTitle>
            <CardDescription>
              Lands in A01, A02, … in add order. Template{" "}
              {template ? template.split("/").pop() : "missing"}. Never overwrites
              an existing file.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3 pt-3">
            {picks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing queued. Add patterns from one or more dumps.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {picks.map((p, i) => (
                  <li
                    key={p.id}
                    className="flex items-start justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2"
                  >
                    <div>
                      <p className="font-mono text-sm">
                        {destLabel(i)} ← {p.dumpName} {p.pattern.label}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.pattern.kit_name || "unnamed"} ·{" "}
                        {p.pattern.sample_refs} sample refs
                      </p>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => removePick(p.id)}
                    >
                      remove
                    </Button>
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
                className="mt-1 font-mono"
                value={outName}
                onChange={(e) => setOutName(e.target.value)}
                placeholder="Fresh_from_picks"
              />
            </label>
            <Button
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
                className="min-h-40 font-mono text-xs"
                value={composeReport}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
