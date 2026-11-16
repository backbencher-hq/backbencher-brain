/**
 * M14 #277 — bash lane-scoped measurement record.
 *
 * WHY THIS FILE EXISTS AND WHY IT IS NOT THE CANONICAL BASELINE
 * -------------------------------------------------------------
 * Two SPEC-gate sections (section-e differential floor, section-f perf budget)
 * read `validation/m14/differential-baseline.json`, which only a CANONICAL
 * `differential.ts --update-baseline` run may write. That run could not be
 * performed honestly at the time this record was written, for two measured
 * reasons rather than two convenient ones:
 *
 *   1. LOAD. `loadavg1` was 33.8 against 8 cores — 4.2x. The pinned rows carry a
 *      `loadContext` precisely so a later breach can be told from a busy machine
 *      (#871), and a row pinned under 4x load would be a row whose number is
 *      contention, not the lane.
 *   2. TREE. 258 files were dirty, including a concurrent session's
 *      in-flight work. The M14 evidence rule is that canonical evidence comes
 *      from a full run on a CLEAN tree; a pin taken now would name a tree state
 *      that does not exist in history.
 *
 * There is also a third reason specific to the baseline FILE: it is shared. A
 * scoped `--update-baseline` merges only the measured lanes into `counts` but
 * OVERWRITES the top-level `loadContext` with its own — so pinning bash from a
 * scoped run would re-stamp all 175 other lanes' rows with this machine's load.
 * That is the lane-scoped-artifact-confuses-a-shared-file trap (`d88724fe`).
 *
 * So the two sections stay RED, and this file records every number the ceremony
 * needs so that it is a re-measure rather than a re-discovery. The gate being
 * red here is the correct state, not an oversight: it says the ceremony has not
 * happened.
 *
 * Writes: validation/m14/results/archive/bash-lane-scoped.json (the ONLY file it writes).
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import os from "node:os"
import { parseFile } from "../../../src/ast/pool-worker"
import { deriveBashEdges } from "../differential"
import { RealBashAnalyzer } from "../../../src/ast/real-bash-analyzer"

const ROOT = process.cwd()
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const OUT = path.join(ROOT, "validation/m14/results/archive/bash-lane-scoped.json")

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-bash.wasm"))))

const REPOS = ["fsharp", "otp"]

interface CorpusResult {
  repo: string
  revision: string
  files: number
  symbols: number
  relationships: number
  truthEdges: number
  covered: number
  missing: number
  unexplained: number
  coverage: number
  relsWithLine: number
  relsWithoutLine: number
  edgeSourcesNotASymbol: number
  emptyNames: number
  unknownKinds: number
  symbolFreeFiles: number
  symlinkedFiles: number
  disagreements: { kind: string; label: string; from: string; target: string; file: string }[]
}

const results: CorpusResult[] = []

for (const repo of REPOS) {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!existsSync(path.join(dir, ".git"))) continue
  const revision = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const tracked = execFileSync("git", ["-C", dir, "ls-files", "*.sh", "*.bash"], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).sort()

  let symbols = 0, relationships = 0, truthEdges = 0, covered = 0
  let relsWithLine = 0, relsWithoutLine = 0, edgeSourcesNotASymbol = 0
  let emptyNames = 0, unknownKinds = 0, symbolFreeFiles = 0, symlinkedFiles = 0
  const disagreements: CorpusResult["disagreements"] = []
  const KINDS = new Set(Object.values(ASTEngine_SymbolKind()))

  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    try { if (statSync(abs).isSymbolicLink()) symlinkedFiles++ } catch { /* not a link */ }

    const tree = parser.parse(text)
    if (!tree) continue
    const scriptName = rel.split("/").pop() ?? "script.sh"
    const truth = deriveBashEdges(tree.rootNode as any, scriptName)
    const direct: any = new RealBashAnalyzer().analyze(tree.rootNode as any, text, abs)
    tree.delete?.()

    let rels: any[] = []
    try {
      const r: any = await parseFile(abs, dir)
      rels = r.relationships ?? []
    } catch {
      /* recorded as an empty analyzer side */
    }

    symbols += direct.symbols.length
    relationships += rels.length
    const declared = new Set((direct.symbols as any[]).map((s) => s.name))
    for (const s of direct.symbols as any[]) {
      if (!s.name || String(s.name).trim() === "") emptyNames++
      if (!KINDS.has(String(s.kind))) unknownKinds++
    }
    if (direct.symbols.length === 0) symbolFreeFiles++
    for (const x of rels) {
      if (typeof x.line_number === "number" && x.line_number > 0) relsWithLine++
      else relsWithoutLine++
      if (!declared.has(String(x.source ?? ""))) edgeSourcesNotASymbol++
    }

    const normRels = rels.map((r: any) => ({
      label: String(r.type ?? r.relationshipType ?? ""),
      target: String(r.target ?? r.to ?? ""),
    }))
    truthEdges += truth.length
    for (const te of truth) {
      if (normRels.some((r) => r.label === te.label && r.target === te.target)) covered++
      else if (disagreements.length < 40) disagreements.push({ kind: "MISSING", label: te.label, from: te.from, target: te.target, file: rel })
    }
    for (const r of normRels) {
      if (truth.some((te) => te.label === r.label && te.target === r.target)) continue
      if (disagreements.length < 40) disagreements.push({ kind: "UNEXPLAINED", label: r.label, from: "(analyzer)", target: r.target, file: rel })
    }
  }

  results.push({
    repo,
    revision,
    files: tracked.length,
    symbols,
    relationships,
    truthEdges,
    covered,
    missing: truthEdges - covered,
    unexplained: disagreements.filter((d) => d.kind === "UNEXPLAINED").length,
    coverage: truthEdges ? +(100 * covered / truthEdges).toFixed(2) : 0,
    relsWithLine,
    relsWithoutLine,
    edgeSourcesNotASymbol,
    emptyNames,
    unknownKinds,
    symbolFreeFiles,
    symlinkedFiles,
    disagreements,
  })
}

function ASTEngine_SymbolKind(): string[] {
  // The engine's own kind vocabulary, read from a lane that emits one of each
  // is not possible at runtime; the set below is the enum's VALUES, which is
  // what the unknown-kind count is a check against. Kept explicit so the check
  // is readable rather than importing a private symbol.
  return [
    "function", "class", "variable", "constant", "interface", "enum", "enum_member",
    "type", "import", "export", "method", "property", "constructor", "namespace",
    "module", "table", "service", "resource", "type_alias", "event", "delegate",
    "object", "record", "macro", "trait", "struct", "impl", "actor", "union",
    "mixin", "extension",
  ]
}

const load = os.loadavg()[0]
const cpus = os.cpus().length

const out = {
  gate: "M14.277-bash-lane-scoped",
  title: "Bash lane measurement, lane-scoped and NOT the canonical baseline",
  scope: {
    canonical: false,
    why: [
      "loadavg1 was 4.2x the core count at measurement time, and a pinned perf row measured under load is a row whose number is contention (#871)",
      "the working tree carried 258 dirty files including a concurrent session's in-flight work, and canonical M14 evidence requires a clean tree",
      "validation/m14/differential-baseline.json is SHARED: a scoped --update-baseline merges the measured lanes into `counts` but overwrites the top-level `loadContext`, so pinning bash from a scoped run would re-stamp all 175 other rows with this machine's load (the lane-scoped-artifact-confuses-a-shared-file trap, d88724fe)",
    ],
    consequence:
      "M14.0.SPEC section-e (differential floor) and section-f (perf budget) remain RED for bash. That is the correct state: the gate says the canonical ceremony has not happened, and this file exists so the ceremony is a re-measure rather than a re-discovery.",
    ceremony: [
      "on a clean tree, at loadavg1 below the core count: bun run script/m14/differential.ts   (canonical, both corpora)",
      "the same run with --update-baseline pins the otp:bash and fsharp:bash rows, and only those lanes' rows are ADDED — but the run's loadContext becomes the file's, which is correct for a canonical run and is why a scoped run may not do it",
      "re-run script/m14/completeness-inventory.ts --lang bash and expect sections e and f to close",
    ],
  },
  measuredAt: new Date().toISOString(),
  commit: execSyncSafe("git rev-parse HEAD"),
  treeDirty: true,
  loadContext: { loadAvg1: +load.toFixed(2), cpus, ratio: +(load / cpus).toFixed(2), scored: load / cpus < 1 },
  corpora: results,
  headline: results.map((r) => ({
    repo: r.repo,
    files: r.files,
    coverage: `${r.coverage}%`,
    missing: r.missing,
    unexplained: r.unexplained,
    relsWithLine: `${r.relsWithLine}/${r.relationships}`,
    edgeSourcesNotASymbol: r.edgeSourcesNotASymbol,
  })),
}

function execSyncSafe(cmd: string): string {
  try {
    return execFileSync("bash", ["-lc", `cd ${JSON.stringify(ROOT)} && ${cmd}`], { encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
console.log(JSON.stringify(out.headline, null, 2))
console.log("loadContext:", JSON.stringify(out.loadContext))
console.log("scope.canonical:", out.scope.canonical)
