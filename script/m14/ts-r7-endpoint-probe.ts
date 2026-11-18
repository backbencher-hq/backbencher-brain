/**
 * DERIV_TS — questions 5 and R7 with a CORPUS-WIDE universe.
 *
 * `ts-ontology-census.ts` answers "does this endpoint bind to a symbol THIS
 * FILE declares", which is the right question for `contains` and the wrong one
 * for `imports` (whose target is `<specifier>:<name>` by contract and therefore
 * binds to nothing in the file by construction) and for `overrides` (whose two
 * endpoints are `Derived.method` and `Base.method`, qualified spellings no file
 * declares under those names).
 *
 * So this probe widens the universe to every symbol the measured corpus
 * declares, and separates the three things the file-scope test conflates:
 *
 *   RESOLVES            the endpoint binds to a declared name, corpus-wide.
 *   NOT_AN_IDENTIFIER   the endpoint cannot be a TypeScript name at all —
 *                       `(call)`, `<lambda>`, `x?`, `a b`. This is the
 *                       objective test; a curated literal list is not, because
 *                       `any`, `name`, `value` and `string` are ordinary
 *                       TypeScript names and a list that convicts them reports
 *                       noise as debt.
 *   PLACEHOLDER_LITERAL a syntactically valid identifier that is nonetheless a
 *                       stand-in for an absent name: `unknown`, `anonymous`,
 *                       `TODO`, `n/a`, `default`.
 *
 * The three are reported separately because they call for different repairs:
 * a `NOT_AN_IDENTIFIER` endpoint is a fabrication, a `PLACEHOLDER_LITERAL` is a
 * policy question, and a `RESOLVES: no` that is a bare name is usually a
 * cross-file reference the analyzer legitimately cannot see from one file.
 *
 * Usage: bun run script/m14/ts-r7-endpoint-probe.ts [--files N] [--repo NAME] [--out path.json]
 */

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const FILES = Number(argOf("--files") ?? "400")
const REPO = argOf("--repo") ?? "typescript"
const OUT = argOf("--out")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(1024 * 1024))

const ALL_TYPES = ["calls", "contains", "exports", "extends", "implements", "imports", "instantiates", "overrides", "references", "uses"] as const

import { nameShapeOk, PLACEHOLDER_LITERALS } from "./ts-endpoint-shape"

type Row = { label: string; end: "source" | "target"; value: string; file: string }
const notIdent: Row[] = []
const placeholder: Row[] = []
const empty: Row[] = []
/** THE FILE-LEVEL SENTINEL: a module-level row's source is `(file)` BY DESIGN (2026-11-17,
 *  JS-twin parity) — it names the FILE, not a symbol, and `metadata.fileLevel` says so. Applying
 *  the identifier test to it convicts every correct module row (measured 373 on element-plus/400
 *  after the migration), so the last two counters test the CONTRACT instead: a sentinel source
 *  must carry metadata.fileLevel:true, and a row carrying the flag must not be sourced elsewhere. */
const fileLevel: Row[] = []
const fileLevelBroken: Row[] = []
/** BINDING-KEY targets: `<scope>\u0000<binding>` (BINDING_SEP, src/ast/types.ts) is a CLAIM KEY the
 *  store verifies, not a name — the imports-target argument, one level down. Measured: every
 *  remaining not-an-identifier endpoint on element-plus/400 after the file-level migration was
 *  one of these (calls 211, uses 51, references 16 — e.g. `render\u0000encode`), so convicting
 *  them would report the lane's local-binding channel as fabrication. */
const bindingKey: Row[] = []
const unresolvedByLabel = new Map<string, Map<string, number>>()
const resolveByLabel = new Map<string, { resolves: number; total: number }>()

const bumpRes = (label: string, ok: boolean): void => {
  const r = resolveByLabel.get(label) ?? { resolves: 0, total: 0 }
  r.total++
  if (ok) r.resolves++
  resolveByLabel.set(label, r)
}
const bumpUnres = (label: string, value: string): void => {
  const m = unresolvedByLabel.get(label) ?? new Map<string, number>()
  m.set(value, (m.get(value) ?? 0) + 1)
  unresolvedByLabel.set(label, m)
}

function gitTracked(dir: string): string[] {
  try { return execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { return [] }
}
const repoDir = path.join(CORPUS, REPO)
const rev = (() => { try { return execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { return "unknown" } })()
const admitted: string[] = []
for (const rel of gitTracked(repoDir).sort()) {
  if (!/\.(ts|tsx|mts|cts)$/.test(rel) || /\.d\.ts$/.test(rel)) continue
  const abs = path.join(repoDir, rel)
  try { if (fs.statSync(abs).size > MAX_BYTES) continue } catch { continue }
  admitted.push(abs)
  if (FILES > 0 && admitted.length >= FILES) break
}
if (!admitted.length) { console.error(`no admitted .ts files under ${repoDir}`); process.exit(2) }

// Pass 1 — the universe: every name the corpus DECLARES.
const universe = new Set<string>()
const perFileNames = new Map<string, Set<string>>()
let idx = 0
const firstPass = async (): Promise<void> => {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const abs = admitted[i]
    let r: any
    try { r = await parseFile(abs, repoDir) } catch { continue }
    const own = new Set<string>()
    for (const s of r?.symbols ?? []) {
      const n = String(s?.name ?? "")
      if (!n) continue
      universe.add(n)
      own.add(n)
    }
    perFileNames.set(abs, own)
  }
}
await Promise.all(Array.from({ length: 8 }, () => firstPass()))

// Pass 2 — the edges, against that universe.
idx = 0
let edges = 0
let parsed = 0
const secondPass = async (): Promise<void> => {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const abs = admitted[i]
    let r: any
    try { r = await parseFile(abs, repoDir) } catch { continue }
    parsed++
    const rel = path.relative(repoDir, abs)
    const own = perFileNames.get(abs) ?? new Set<string>()
    for (const rel0 of r?.relationships ?? []) {
      const label = String(rel0?.type ?? rel0?.relationshipType ?? "")
      if (!label) continue
      edges++
      for (const [end, key] of [["source", "source"], ["target", "target"]] as const) {
        const v = String((rel0 as any)?.[key] ?? (end === "source" ? rel0?.from : rel0?.to) ?? "")
        if (!v) { if (empty.length < 60) empty.push({ label, end, value: v, file: rel }); continue }
        const meta = (rel0 as any)?.metadata ?? {}
        if (end === "source" && v === "(file)") {
          if (meta.fileLevel === true) { if (fileLevel.length < 400) fileLevel.push({ label, end, value: v, file: rel }); continue }
          if (fileLevelBroken.length < 40) fileLevelBroken.push({ label, end, value: v, file: rel })
          continue
        }
        if (end === "source" && meta.fileLevel === true && v !== "(file)") {
          if (fileLevelBroken.length < 40) fileLevelBroken.push({ label, end, value: v, file: rel })
        }
        // `imports` publishes a COMPOUND endpoint by contract — `<specifier>:<name>`,
        // where the specifier is a PATH and the pair is a lookup key rather than a
        // name. Applying the name test to it convicts 378 correct rows on a 200-file
        // draw, so the test is applied to the NAME HALF, which is the part that is
        // supposed to be a name.
        // `imports` TARGETS are a COMPOUND LOOKUP KEY by contract — `<specifier>:<name>`,
        // `<scope>\u0000<module>:*`, or a bare declared name for a local named import. Applying a
        // name test to any half of it convicts correct rows (the `*` member of a namespace row is
        // not an identifier; a side-effect row names a path). The contract comment in the file
        // header says the test belongs on the NAME HALF; measurement showed the half is not
        // recoverable for every row shape, so the fabrication tests are not applied at all and the
        // shape is audited by the imports/exports audit instead. Resolution is still counted.
        if (end === "target" && v.indexOf("\u0000") >= 0) { if (bindingKey.length < 5000) bindingKey.push({ label, end, value: v, file: rel }); continue }
        if (!(label === "imports" && end === "target")) {
          if (!nameShapeOk(v)) { if (notIdent.length < 5000) notIdent.push({ label, end, value: v, file: rel }); continue }
          if (PLACEHOLDER_LITERALS.has(v.toLowerCase())) { if (placeholder.length < 5000) placeholder.push({ label, end, value: v, file: rel }); continue }
        }
        if (end === "target") {
          const hit = universe.has(v) || own.has(v) || v.split(".").every((seg) => universe.has(seg))
          bumpRes(label, hit)
          if (!hit) bumpUnres(label, v)
        }
      }
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => secondPass()))

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`DERIV_TS endpoint probe — ${REPO}@${rev.slice(0, 10)}`)
console.log(`${admitted.length} files, ${universe.size} distinct declared names in the universe, ${edges.toLocaleString()} edges\n`)
console.log(`${w("label", 14)}${w("target edges", 14)}${w("corpus-resolves", 16)}${w("%", 8)}top unresolved target names`)
console.log("-".repeat(120))
const out: any = { at: new Date().toISOString(), corpus: REPO, revision: rev, files: admitted.length, universeSize: universe.size, edges, types: {}, emptyEndpoints: empty, notAnIdentifier: notIdent, placeholderLiterals: placeholder, fileLevelSources: fileLevel, fileLevelContractViolations: fileLevelBroken, bindingKeyTargets: bindingKey }
for (const t of ALL_TYPES) {
  const r = resolveByLabel.get(t) ?? { resolves: 0, total: 0 }
  const un = [...(unresolvedByLabel.get(t) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  out.types[t] = { targetEdges: r.total, corpusResolves: r.resolves, pct: r.total ? +(100 * r.resolves / r.total).toFixed(1) : null, topUnresolved: un }
  console.log(`${w(t, 14)}${w(String(r.total), 14)}${w(`${r.resolves}/${r.total}`, 16)}${w(r.total ? (100 * r.resolves / r.total).toFixed(1) + "%" : "-", 8)}${un.map(([k, n]) => `${k}:${n}`).join(" ")}`)
}
const byLabel = (rows: Row[]): string => {
  const m = new Map<string, number>()
  for (const r of rows) { const k = `${r.label}/${r.end}`; m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join("  ")
}
console.log(`\nEMPTY endpoints: ${empty.length === 0 ? "(none)" : byLabel(empty)}`)
console.log(`FILE-LEVEL sources (metadata.fileLevel true, source "(file)"): ${fileLevel.length}`)
console.log(`BINDING-KEY targets (<scope>\u0000<binding>, a claim key by contract): ${bindingKey.length === 0 ? "(none)" : byLabel(bindingKey)}`)
console.log(`FILE-LEVEL CONTRACT VIOLATIONS (sentinel without the flag, or flag without the sentinel): ${fileLevelBroken.length === 0 ? "(none)" : byLabel(fileLevelBroken)}`)
for (const r of fileLevelBroken.slice(0, 40)) console.log(`    ${r.label} ${r.end}=${JSON.stringify(r.value)}  ${r.file}`)
const CAP = 5000
console.log(`NOT-AN-IDENTIFIER endpoints: ${notIdent.length === 0 ? "(none)" : byLabel(notIdent)}${notIdent.length >= CAP ? `  ** TRUNCATED AT ${CAP}: the by-label counts above may be a lower bound` : ""}`)
for (const r of notIdent.slice(0, 60)) console.log(`    ${r.label} ${r.end}=${JSON.stringify(r.value)}  ${r.file}`)
console.log(`PLACEHOLDER-LITERAL endpoints: ${placeholder.length === 0 ? "(none)" : byLabel(placeholder)}`)
for (const r of placeholder.slice(0, 20)) console.log(`    ${r.label} ${r.end}=${JSON.stringify(r.value)}  ${r.file}`)
if (OUT) { fs.writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }