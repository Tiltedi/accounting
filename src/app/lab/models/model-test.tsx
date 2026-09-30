"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { Doc } from "@/lib/documents";
import type { Extraction } from "@/lib/extraction";

type Run = { model: string; ms: number; costUsd: number; result: Extraction | null; error: string | null };
type Row = { doc: Doc; runs?: Run[]; error?: string };

const FIELDS = ["vendor", "doc_date", "total", "tax", "currency", "category", "doc_type", "invoice_number"] as const;
const LABEL: Record<string, string> = { "claude-opus-5-5": "Opus (now)", "claude-sonnet-5-5": "Sonnet" };

function same(a: unknown, b: unknown) {
  const norm = (v: unknown) => (v == null || v === "" ? null : typeof v === "number" ? v.toFixed(2) : String(v).trim().toLowerCase());
  return norm(a) === norm(b);
}

export function ModelTest({ docs }: { docs: Doc[] }) {
  const [rows, setRows] = useState<Row[]>(docs.map((doc) => ({ doc })));
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    const queue = [...docs];
    const worker = async () => {
      for (let doc = queue.shift(); doc; doc = queue.shift()) {
        const current = doc;
        try {
          const response = await fetch("/api/model-test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: current.id }),
          });
          const data = await response.json();
          setRows((prev) => prev.map((r) => (r.doc.id === current.id ? { ...r, runs: data.runs, error: data.error } : r)));
        } catch {
          setRows((prev) => prev.map((r) => (r.doc.id === current.id ? { ...r, error: "Request failed" } : r)));
        }
      }
    };
    await Promise.all([worker(), worker()]);
    setRunning(false);
  }

  // Agreement with the saved values (which include your own corrections).
  const stats = ["claude-opus-5-5", "claude-sonnet-5-5"].map((model) => {
    let fields = 0;
    let agree = 0;
    let ms = 0;
    let cost = 0;
    let n = 0;
    for (const row of rows) {
      const r = row.runs?.find((x) => x.model === model);
      if (!r?.result) continue;
      n++;
      ms += r.ms;
      cost += r.costUsd;
      for (const f of FIELDS) {
        fields++;
        if (same(r.result[f], row.doc[f])) agree++;
      }
    }
    return { model, n, agree, fields, ms: n ? ms / n : 0, cost: n ? cost / n : 0 };
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold">Model test</h1>
      <p className="mt-1 text-sm text-muted">
        Reads your {docs.length} latest documents with both models and compares them with the values saved in the app. Nothing is changed. Cost: about $0.035 per document.
      </p>
      <button
        type="button"
        onClick={run}
        disabled={running || !docs.length}
        className="mt-4 flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink disabled:opacity-60"
      >
        {running && <LoaderCircle className="size-4 animate-spin" />} {running ? "Running…" : "Run test"}
      </button>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {stats.map((s) => (
          <div key={s.model} className="rounded-2xl border border-rule bg-card p-4">
            <div className="font-semibold">{LABEL[s.model]}</div>
            <div className="nums mt-2 text-sm">
              {s.n ? (
                <>
                  Matches saved values: <b>{Math.round((s.agree / s.fields) * 100)}%</b> ({s.agree}/{s.fields} fields)
                  <br />
                  Average time: <b>{(s.ms / 1000).toFixed(1)} s</b> · cost <b>${s.cost.toFixed(4)}</b>
                </>
              ) : (
                <span className="text-muted">No results yet</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {rows.map(({ doc, runs, error }) => (
          <section key={doc.id} className="overflow-x-auto rounded-2xl border border-rule bg-card p-4 text-sm">
            <div className="font-semibold">{doc.vendor || doc.file_name}</div>
            {error && <p className="text-danger">{error}</p>}
            {runs && (
              <table className="nums mt-2 w-full text-left">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="pr-3 font-medium">Field</th>
                    <th className="pr-3 font-medium">Saved</th>
                    {runs.map((r) => (
                      <th key={r.model} className="pr-3 font-medium">
                        {LABEL[r.model]} · {(r.ms / 1000).toFixed(1)} s
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FIELDS.map((f) => (
                    <tr key={f}>
                      <td className="pr-3 text-muted">{f}</td>
                      <td className="pr-3">{String(doc[f] ?? "—")}</td>
                      {runs.map((r) => (
                        <td key={r.model} className={`pr-3 ${r.result && !same(r.result[f], doc[f]) ? "font-semibold text-danger" : ""}`}>
                          {r.error ? r.error : String(r.result?.[f] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
