/**
 * VERIFY THE ERLANG `exports` / `imports` ORACLE — and prove it can fail.
 *
 *   bun script/m14/verify-erlang-ontology-oracle.ts [--sample 400] [--out path]
 *
 * ## Why
 *
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 reports, at HEAD, `erlang 2
 * un-audited: ["exports","imports"]` — two labels the analyzer emits (ER-D40, ER-D41) and
 * that no oracle derives. `script/m14/oracles/erlang-exports-imports.ts` is the lane's
 * derivation; this script is what makes it an instrument rather than an assertion.
 *
 * An oracle nobody has watched disagree is a second source of the same prose it was written
 * to replace, so the three things checked here are:
 *
 *   1 AGREEMENT   over the lane's own fixtures AND a corpus draw: MISSING 0, unexplained 0
 *                  on both labels. Not "high" — zero, because both sides read the SAME
 *                  declaration and there is no heuristic in either.
 *   2 REACHABILITY the oracle is not a dead export: it is invoked over real trees, and a
 *                  non-zero truth count per label is required. An oracle that returns
 *                  nothing would otherwise pass check 1 vacuously — the exact state
 *                  `overrides` was in for haskell ("in haskell's F5 label set, yet neither
 *                  the analyzer nor the oracle emitted a single row").
 *   3 ABILITY TO FAIL  three deliberately broken copies of the derivation, each of which
 *                  must make the same check go red:
 *                    (a) `-export_type` read as a plain `-export`   -> drops the form
 *                    (b) the `fa` arity read as 0                    -> breaks identity
 *                    (c) the module atom of `-import` not read     -> emits nothing
 *                  A verifier that cannot report a failure is not a verifier.
 *
 * READ-ONLY apart from the artifact.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { deriveErlangExportsTruth, ERLANG_ORACLE_LABELS } from "./oracles/erlang-exports-imports"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
// Overloads: a flag read WITH a default always yields a string, and the single
// `string | undefined` signature could not say so — `--repos` then had to be treated as
// optional where this file's own default makes it required.
function argOf(n: string): string | undefined
function argOf(n: string, d: string): string
function argOf(n: string, d?: string): string | undefined {
  return argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d
}
const SAMPLE = Number(argOf("sample", "400"))
const OUT = argOf("out")
const REPOS = (argOf("repos", "otp,elixir")).split(",").map((s) => s.trim()).filter(Boolean)
const ROOT = resolve((import.meta as any).dirname ?? dirname(process.argv[1] ?? "."), "..", "..")
const LABELS = ["exports", "imports"] as const

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(join(ROOT, "wasm", "tree-sitter-erlang.wasm"))))

type Deriver = (root: any) => Array<{ label: string; target: string }>

/** The three broken copies. Each is a faithful "what if the reader got it wrong" state,
 *  not an arbitrary corruption, because a mutation nobody can explain teaches nobody. */
const BROKEN: Array<{ name: string; why: string; derive: Deriver }> = [
  {
    name: "broken/export-type-read-as-export",
    why: "`-export_type([t/0])` is read as a plain `-export`, so the published type loses its form.",
    derive: (root) => deriveErlangExportsTruth(root).map((e) => (e.form === "export_type" ? { ...e, form: "export" } : e)),
  },
  {
    name: "broken/fa-arity-read-as-zero",
    why: "the `fa`'s arity is not read, so every published identity is reported as `/0` and the identity no longer matches the analyzer's own arity.",
    derive: (root) => deriveErlangExportsTruth(root).map((e) => (e.label === "exports" && e.identity && e.identity.includes("/") ? { ...e, identity: `${e.identity.slice(0, e.identity.indexOf("/"))}/0` } : e)),
  },
  {
    name: "broken/import-module-atom-not-read",
    why: "the module atom of `-import(Mod, [...])` is not read, so the `imports` class emits nothing at all.",
    derive: (root) => deriveErlangExportsTruth(root).filter((e) => e.label !== "imports"),
  },
]

type Row = { where: string; abs: string; content: string; root: any }
async function load(): Promise<{ fixtures: Row[]; corpus: Row[] }> {
  const fixtures: Row[] = []
  const dir = join(ROOT, "validation", "m14", "fixtures", "erlang")
  const names = execFileSync("sh", ["-c", `ls ${dir}/*.erl 2>/dev/null || true`], { encoding: "utf8" }).split("\n").filter(Boolean).sort()
  for (const abs of names) {
    const content = readFileSync(abs, "utf8")
    fixtures.push({ where: `fixture erlang/${abs.split("/").pop()}`, abs, content, root: parser.parse(content).rootNode })
  }
  const corpus: Row[] = []
  for (const repo of REPOS) {
    const dir2 = join(CR, repo)
    let tracked: string[]
    try { tracked = execFileSync("git", ["-C", dir2, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    const admitted: string[] = []
    for (const rel of tracked.sort()) {
      if (!rel.endsWith(".erl") && !rel.endsWith(".hrl")) continue
      const abs = join(dir2, rel)
      try {
        if (statSync(abs).size > 512 * 1024) continue
        if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "erlang") continue
      } catch { continue }
      admitted.push(abs)
    }
    const stride = Math.max(1, Math.floor(admitted.length / Math.max(1, Math.ceil(SAMPLE / REPOS.length))))
    for (const abs of admitted.filter((_, i) => i % stride === 0)) {
      const content = readFileSync(abs, "utf8")
      corpus.push({ where: `corpus ${repo}/${abs.slice(dir2.length + 1)}`, abs, content, root: parser.parse(content).rootNode })
    }
  }
  return { fixtures, corpus }
}

/**
 * The measured row.
 *
 * `formMismatch` and `arityMismatch` are here because a comparison on `(label, target)`
 * CANNOT see either of them, and the verifier has to be able to fail on them. The first
 * version compared targets only, so its two `-export_type`-shaped broken copies were
 * reported "MISSED": the broken oracle produced the same target set as the correct one,
 * which is a true statement about the TARGET and a false statement about the derivation.
 * A verifier that can only detect one class of defect is a verifier with a blind spot,
 * and naming the blind spot is cheaper than discovering it later.
 */
type Measured = { truth: number; analyzer: number; missing: number; unexplained: number; detailMismatch: number; exMissing: string[]; exUnexplained: string[]; exDetail: string[] }

/**
 * The measured row, and the shape both sides are NORMALISED into before comparison.
 *
 * Normalisation is not leniency, it is the only way two independent readers of the same
 * declaration can be compared at all — and every choice below is a place where the first
 * version of this verifier was wrong in a direction that produced a confident number:
 *
 *   target         the bare name. `-export([join/2])` and `-export([join/3])` in two lists
 *                  is ordinary Erlang (otp/lib/kernel/src/pg.erl), so a target can carry
 *                  SEVERAL identities; the first version kept one per target and reported
 *                  84 arity mismatches that were its own collapse.
 *   identity SET   `form/arity` per published identity. For `exports` the analyzer records
 *                  `meta.exportForm` + `meta.arity` and the oracle records `form` +
 *                  `identity`; for `imports` the analyzer records `meta.importedFunctions`
 *                  (NAMES) and the oracle records `importedNames`. The first version
 *                  compared a `form/arity` string on one side against a `form/identity`
 *                  string on the other and reported every row as a mismatch — 2,645 of
 *                  them — which is the verifier disagreeing with itself.
 */
async function measure(rows: Row[], derive: Deriver): Promise<Record<string, Measured>> {
  const out: Record<string, Measured> = {}
  for (const l of LABELS) out[l] = { truth: 0, analyzer: 0, missing: 0, unexplained: 0, detailMismatch: 0, exMissing: [], exUnexplained: [], exDetail: [] }

  const analyzerIdentities = (x: any): string[] => {
    const m = (x.metadata as any) ?? {}
    if (String(x.type) === "exports") return [`${String(m.exportForm ?? "")}/${String(m.arity ?? "")}`]
    const names = Array.isArray(m.importedFunctions) ? m.importedFunctions.map(String).sort() : []
    return [`import/${names.join(",")}`]
  }
  const oracleIdentities = (e: any): string[] => {
    if (e.label === "exports") {
      const slash = String(e.identity ?? "").indexOf("/")
      return [`${String((e as any).form ?? "")}/${slash >= 0 ? String((e as any).identity).slice(slash + 1) : ""}`]
    }
    const names = Array.isArray((e as any).importedNames) ? (e as any).importedNames.map(String).sort() : []
    return [`import/${names.join(",")}`]
  }

  for (const row of rows) {
    let r: any
    try { r = await parseFile(row.abs, dirname(row.abs)) } catch { continue }
    const got: Record<string, Map<string, Set<string>>> = { exports: new Map(), imports: new Map() }
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? "")
      if (t !== "exports" && t !== "imports") continue
      const set = got[t]!.get(String(x.target)) ?? new Set<string>()
      for (const id of analyzerIdentities(x)) set.add(id)
      got[t]!.set(String(x.target), set)
    }
    const truth: Record<string, Map<string, Set<string>>> = { exports: new Map(), imports: new Map() }
    let derived: Array<any> = []
    try { derived = derive(row.root) ?? [] } catch { continue }
    for (const e of derived) {
      if (e.label !== "exports" && e.label !== "imports") continue
      const set = truth[e.label]!.get(String(e.target)) ?? new Set<string>()
      for (const id of oracleIdentities(e)) set.add(id)
      truth[e.label]!.set(String(e.target), set)
    }
    for (const l of LABELS) {
      out[l].truth += truth[l]!.size
      out[l].analyzer += got[l]!.size
      for (const [k] of truth[l]!) if (!got[l]!.has(k)) { out[l].missing++; if (out[l].exMissing.length < 6) out[l].exMissing.push(`${row.where}: ${k}`) }
      for (const [k] of got[l]!) if (!truth[l]!.has(k)) { out[l].unexplained++; if (out[l].exUnexplained.length < 6) out[l].exUnexplained.push(`${row.where}: ${k}`) }
      for (const [k, v] of truth[l]!) {
        const a = got[l]!.get(k)
        if (!a) continue
        // A SET comparison, so a name published at two arities on both sides matches.
        for (const id of v) if (!a.has(id)) { out[l].detailMismatch++; if (out[l].exDetail.length < 6) out[l].exDetail.push(`${row.where}: ${k} oracle=${id} not in analyzer={${[...a].sort().join(",")}}`) }
        for (const id of a) if (!v.has(id)) { out[l].detailMismatch++; if (out[l].exDetail.length < 6) out[l].exDetail.push(`${row.where}: ${k} analyzer=${id} not in oracle={${[...v].sort().join(",")}}`) }
      }
    }
  }
  return out
}

const { fixtures, corpus } = await load()
console.log(`verify erlang exports/imports oracle — ${fixtures.length} lane fixtures + ${corpus.length} corpus files (stride-sampled from ${REPOS.join(" + ")})`)
console.log(`labels the oracle module exports as audited: ${JSON.stringify(ERLANG_ORACLE_LABELS)}\n`)

const live = await measure([...fixtures, ...corpus], deriveErlangExportsTruth)
let failed = 0
console.log("CHECK 1 — AGREEMENT (MISSING 0, unexplained 0 on both labels)")
for (const l of LABELS) {
  const m = live[l]!
  const ok = m.missing === 0 && m.unexplained === 0 && m.detailMismatch === 0
  if (!ok) failed++
  console.log(`  ${l.padEnd(9)} truth ${String(m.truth).padStart(6)}  analyzer ${String(m.analyzer).padStart(6)}  MISSING ${String(m.missing).padStart(5)}  unexplained ${String(m.unexplained).padStart(5)}  identity-mismatch ${String(m.detailMismatch).padStart(5)}  ${ok ? "PASS" : "FAIL"}`)
  for (const x of m.exMissing) console.log(`      MISSING     ${x}`)
  for (const x of m.exUnexplained) console.log(`      unexplained ${x}`)
  for (const x of m.exDetail) console.log(`      identity     ${x}`)
}

console.log("\nCHECK 2 — REACHABILITY (the oracle emits rows; a vacuous truth set would pass check 1)")
for (const l of LABELS) {
  const ok = live[l]!.truth > 0
  if (!ok) failed++
  console.log(`  ${l.padEnd(9)} truth rows ${String(live[l]!.truth).padStart(6)}  ${ok ? "PASS" : "FAIL — the oracle derives nothing, so check 1 was vacuous"}`)
}

console.log("\nCHECK 3 — ABILITY TO FAIL (each broken copy must turn the same check red)")
const abilityToFail: Array<{ name: string; verdict: string; detail: string[] }> = []
for (const b of BROKEN) {
  const m = await measure([...fixtures, ...corpus], b.derive)
  // A broken copy must be WORSE THAN THE LIVE DERIVATION, not merely non-zero. The first
  // version of this check asked only "is anything non-zero?", and while the live oracle
  // had 3 unexplained rows it reported two unrelated broken copies as DETECTED — a
  // detection that was really the baseline's own failure, which is precisely the shape of
  // a gate that passes for the wrong reason.
  const score = (x: Record<string, Measured>): number =>
    LABELS.reduce((a, l) => a + x[l]!.missing + x[l]!.unexplained + x[l]!.detailMismatch, 0)
  const broke = score(m) > score(live)
  if (!broke) failed++
  abilityToFail.push({ name: b.name, verdict: broke ? "the broken copy WAS detected" : "NOT DETECTED", detail: LABELS.map((l) => `${l}: truth ${m[l]!.truth} MISSING ${m[l]!.missing} unexplained ${m[l]!.unexplained} identity ${m[l]!.detailMismatch}   live: MISSING ${live[l]!.missing} unexplained ${live[l]!.unexplained} identity ${live[l]!.detailMismatch}`) })
  console.log(`  ${broke ? "DETECTED  " : "MISSED    "} ${b.name}`)
  console.log(`      ${b.why}`)
  for (const d of abilityToFail[abilityToFail.length - 1]!.detail) console.log(`      ${d}`)
}

const outPath = OUT ?? join(ROOT, "validation", "m14", "tmp", "erlang-ontology-oracle-verification.json")
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, `${JSON.stringify({
  at: new Date().toISOString(),
  script: "verify-erlang-ontology-oracle",
  corpus: { root: CR, repos: REPOS, fixtures: fixtures.length, corpusFiles: corpus.length },
  agreement: live,
  reachability: Object.fromEntries(LABELS.map((l) => [l, live[l]!.truth])),
  abilityToFail,
  failures: failed,
}, null, 2)}\n`)
console.log(`\nartifact: ${outPath}`)
if (failed) {
  console.log(`\n>>> ${failed} check(s) FAILED`)
  process.exit(1)
}
console.log("\nall checks pass, and each of the three broken copies was detected")
