// script/m18/verify-benchmark.ts — M18.Q1 (benchmark integrity).
//
// 1. Format: every query has id/corpus/mode/query + expected (object) with
//    symbol/file/line/why, OR explicit negative (expected=null + why).
// 2. Every non-negative expected symbol RESOLVES in a FRESH index of its
//    corpus (name + file + line within tolerance) — no dangling gold.
// 3. Corpus sources exist on disk (missing = reported, never skipped).
// 4. Emit validation/m18/results/Q1.json.

import { writeFileSync, readFileSync, mkdtempSync, cpSync, rmSync, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"

let checks = 0, passed = 0, failed = 0, negatives = 0, negativePassed = 0
function ck(label: string, cond: boolean, detail?: string) { checks++; if (cond) passed++; else { failed++; console.log("  FAIL: " + label + (detail ? " — " + detail : "")) } }

const ROOT_DIR = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT_DIR, "validation/m18/results")
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
const bench = JSON.parse(readFileSync(path.join(ROOT_DIR, "validation/m18/benchmark/benchmark.json"), "utf8"))
const corpora = new Map<string, any>(bench.corpora.map((c: any) => [c.tag, c]))

async function indexCorpus(tag: string): Promise<{ raw: any; pid: string; tmp: string }> {
  const c = corpora.get(tag)
  const tmp = mkdtempSync(path.join(tmpdir(), "m18bench-"))
  try {
    cpSync(c.source, tmp, { recursive: true })
    const pid = getProjectId(tmp)
    await indexProjectParallel(pid, tmp, {})
    const raw = await BrainDatabase.getRawInstance(pid)
    return { raw, pid, tmp }
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true })
    throw e
  }
}

function resolveGold(raw: any, pid: string, gold: any): string | null {
  const row = raw.prepare(
    "SELECT s.name, f.relative_path AS fp, s.line_start AS ln FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.name=?",
  ).get(pid, gold.symbol) as any
  if (!row) return "symbol '" + gold.symbol + "' not found"
  if (!row.fp.includes(gold.file)) return "file mismatch: expected contains '" + gold.file + "' got '" + row.fp + "'"
  if (Math.abs((row.ln || 0) - (gold.line || 0)) > 40) return "line mismatch: expected ~" + gold.line + " got " + row.ln + " (" + row.fp + ")"
  return null
}

async function main() {
  console.log("── Q1  benchmark integrity ──")
  const queries = bench.queries
  ck("Q1: schema version + governance present", bench.version === 1 && typeof bench.governance === "string" && bench.governance.length > 20, "")
  ck("Q1: three corpora declared", bench.corpora.length === 3, "n=" + bench.corpora.length)

  for (const q of queries) {
    const ok = q.id && q.corpus && q.mode && q.query
    ck("Q1: entry " + q.id + " has id/corpus/mode/query", !!ok, JSON.stringify(q).slice(0, 80))
    const isNegSchema = q.expected === null || q.negative === true
    if (isNegSchema) {
      negatives++
      // Strict schema (caught by Q3): a negative MUST be marked negative:true
      // AND carry expected:null AND a why — no implicit negatives.
      ck("Q1: negative " + q.id + " is explicitly negative:true", q.negative === true, "")
      ck("Q1: negative " + q.id + " has expected:null", q.expected === null, "")
      ck("Q1: negative " + q.id + " documents why (no gold)", !!q.why, "")
      continue
    }
    const gold = q.expected
    ck("Q1: " + q.id + " gold has symbol/file/line/why", !!(gold?.symbol && gold?.file && gold?.line && gold?.why), "")
  }

  for (const c of bench.corpora as any[]) {
    ck("Q1: corpus " + c.tag + " source exists", existsSync(c.source), c.source)
  }

  // Resolve all non-negative golds against FRESH indexes.
  const resolvedByCorpus: Record<string, { total: number; ok: number }> = {}
  for (const c of bench.corpora as any[]) {
    if (!existsSync(c.source)) continue
    console.log("  indexing " + c.tag + " ...")
    let raw: any = null, pid = "", tmp = ""
    try { const r = await indexCorpus(c.tag); raw = r.raw; pid = r.pid; tmp = r.tmp } catch (e: any) { ck("Q1: index " + c.tag, false, String(e?.message || e)); continue }
    try {
      const qs = queries.filter((q: any) => q.corpus === c.tag && q.expected !== null)
      resolvedByCorpus[c.tag] = { total: qs.length, ok: 0 }
      for (const q of qs) {
        const err = resolveGold(raw, pid, q.expected)
        if (err) { ck("Q1: gold '" + q.id + "' resolves in fresh " + c.tag + " index", false, err) }
        else { resolvedByCorpus[c.tag].ok++ }
      }
      ck("Q1: all " + c.tag + " golds resolve in a fresh index", resolvedByCorpus[c.tag].ok === resolvedByCorpus[c.tag].total, resolvedByCorpus[c.tag].ok + "/" + resolvedByCorpus[c.tag].total)
    } finally {
      if (pid) { try { await (await import("../../src/ast/parallel-indexer")).flushBackgroundEmbeddings(pid) } catch {} }
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  const e = { issue: "M18.Q1", code: "Q1", tool: "benchmark", title: "real-corpus retrieval benchmark (rake, lodash, element-plus)", verified: failed === 0, checks, passed, failed, negatives, generatedAt: new Date().toISOString(), perCorpus: resolvedByCorpus, totalQueries: queries.length, negativeLine: "Gold answers are human-reviewed; a resolving symbol is NOT a guarantee of semantic relevance — that is Q2's job." }
  writeFileSync(path.join(RESULTS_DIR, "Q1.json"), JSON.stringify(e, null, 2) + "\n")
  console.log("Q1: " + (failed === 0 ? "VERIFIED" : "KNOWN-GAP") + " (" + passed + "/" + checks + " passed)")
  process.exit(failed === 0 ? 0 : 1)
}

await main()