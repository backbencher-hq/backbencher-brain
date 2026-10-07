/**
 * PYTHON ENDPOINT-DEFECT PROBE — names the DEFECT CLASSES the resolution census
 * counts, one measurement each.
 *
 * `python-endpoint-resolution.ts` answers "how many endpoints bind?". This file
 * answers "which endpoints do NOT bind, and WHY" — because a rate with no named
 * cause is a number nobody can act on, and every class below was found by reading a
 * NAMED SAMPLE of the census rather than by reading the analyzer's source.
 *
 * Each class is a separate, falsifiable claim:
 *
 *   D1  contains into a symbol the PRODUCTION PATH DELETES. `pool-worker`'s
 *       `keepSymbol` carries a cross-language UNIVERSAL denylist — `root`,
 *       `program`, `source_file`, `module_declaration`, `package_manifest`,
 *       `unknown` — described in its own comment as "language keywords /
 *       conventions and synthetic tree-sitter artifact names". In python `root`,
 *       `source_file` and `program` are ordinary declarations. The analyzer
 *       publishes `contains Owner -> root` (a true fact about the class), the
 *       store deletes the `root` symbol, and the edge survives: an edge into
 *       nothing. The rule is read from the production function, never re-typed.
 *
 *   D2  references into an INTERPRETER BUILTIN. The analyzer filters 11 primitive
 *       type names (`str int float complex bool bytes object None Any self cls`)
 *       and not the other 144 in `dir(builtins)` — so `-> list`, `-> dict`,
 *       `-> set`, `-> tuple`, `-> type`, `-> property` become edges naming names
 *       the graph can never hold. Measured, not assumed: the builtin set is read
 *       from the interpreter by subprocess.
 *
 *   D3  EMPTY or whitespace-only endpoints on any edge.
 *
 *   D4  placeholder-literal endpoints — and GATED ON THE SOURCE, because
 *       CPython's own `uuid.py` declares `class SafeUUID: unknown = None`, so a
 *       bare word list convicts true edges. Reported as two numbers: placeholder
 *       names that are ABSENT from the file (invented) and placeholder names
 *       that are PRESENT (the rule firing on real code).
 *
 *   D5  `uses` self-loops (`f -> f`): a member read whose leaf is the reading
 *       function's own name. Not automatically wrong — a getter reading
 *       `self.prop` from a method named `prop` is ordinary — so it is counted and
 *       sampled, never asserted.
 *
 *   D6  symbols with an EMPTY name, and symbols whose name is a placeholder
 *       literal — the symbol-side of R7 rather than the edge-side.
 *
 * NO REGEX anywhere. `keepSymbol` is imported from the production module; the
 * builtin set comes from `dir(builtins)` through `json`; every membership test is a
 * Set lookup. Source text is read ONLY as a substring, never pattern-matched.
 *
 * Usage: bun run script/m14/python-endpoint-defects.ts [--repo python-codesql]
 *                                                     [--stdlib] [--out p.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile, keepSymbol, filterNoiseRelationships } from "../../src/ast/pool-worker"

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_FILTER = argOf("--repo")
const LIMIT = Number(argOf("--limit") ?? "0")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(1024 * 1024))
const STDLIB = argv.includes("--stdlib")
const STDLIB_DIR = argOf("--stdlib-dir") ?? "/usr/lib/python3.10"
const SKIP_DIR_NAMES = new Set(["test", "tests", "lib2to3", "idlelib", "site-packages", "testdata"])
const WORKERS = Number(argOf("--workers") ?? "1")

const PY_BUILTIN_NAMES: Set<string> = (() => {
  try {
    const out = execFileSync("python3", ["-c", "import builtins, json; print(json.dumps(sorted(dir(builtins))))"], {
      encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    })
    return new Set(JSON.parse(out) as string[])
  } catch { return new Set<string>() }
})()

/** The 11 the analyzer already filters, stated so D2's arithmetic is checkable. */
const ANALYZER_PRIMITIVES = new Set([
  "str", "int", "float", "complex", "bool", "bytes", "object", "None", "Any", "self", "cls",
])
const PLACEHOLDERS = new Set(["<unknown>", "unknown_symbol", "unknownsymbol", "unknownSymbol", "<anonymous>", "<lambda>", "PLACEHOLDER", "PLACEHOLDER_SYMBOL"])
const PLACEHOLDER_PREFIXES = ["<"]

const isPlaceholderShape = (s: string): boolean => {
  const n = s.trim()
  if (PLACEHOLDERS.has(n)) return true
  for (const p of PLACEHOLDER_PREFIXES) if (n.startsWith(p)) return true
  return false
}
const leafOf = (s: string): string => {
  const c = s.indexOf(":")
  if (c > 0) return s.slice(c + 1)
  const d = s.lastIndexOf(".")
  if (d > 0) return s.slice(d + 1)
  return s
}

// ---------------------------------------------------------------- corpus
type CorpusFile = { repo: string; dir: string; rel: string; abs: string }
const all: CorpusFile[] = []
if (STDLIB) {
  const walk = (d: string, depth: number): void => {
    if (depth > 8 || all.length > 20000) return
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (SKIP_DIR_NAMES.has(e.name)) continue
      const abs = path.join(d, e.name)
      if (e.isDirectory()) { walk(abs, depth + 1); continue }
      if (!(e.name.endsWith(".py") || e.name.endsWith(".pyi"))) continue
      try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
      all.push({ repo: "cpython-stdlib", dir: STDLIB_DIR, rel: path.relative(STDLIB_DIR, abs), abs })
    }
  }
  walk(STDLIB_DIR, 0)
}
for (const e of readdirSync(CR)) {
  if (STDLIB) break
  const dir = path.join(CR, e)
  if (REPO_FILTER && !e.includes(REPO_FILTER)) continue
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
    if (detectLanguageFromPath(abs) !== "python") continue
    all.push({ repo: e, dir, rel, abs })
  }
  if (REPO_FILTER && all.length) break
}
const admitted = LIMIT ? all.slice(0, LIMIT) : all

// ---------------------------------------------------------------- tallies
type Defect = { count: number; files: Set<string>; byType: Map<string, number>; byName: Map<string, number>; samples: string[] }
const mk = (): Defect => ({ count: 0, files: new Set(), byType: new Map(), byName: new Map(), samples: [] })
const D1 = mk(), D2 = mk(), D3 = mk(), D4invented = mk(), D4present = mk(), D5 = mk(), D6empty = mk(), D6placeholder = mk(), D7 = mk()

const hit = (d: Defect, label: string, type: string, name: string, sample: string, cap = 8) => {
  d.count++
  d.files.add(label)
  d.byType.set(type, (d.byType.get(type) ?? 0) + 1)
  d.byName.set(name, (d.byName.get(name) ?? 0) + 1)
  if (d.samples.length < cap) d.samples.push(sample)
}

let parsed = 0, failed = 0, totalRels = 0, totalSyms = 0
let idx = 0
const worker = async (): Promise<void> => {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let r: any
    let text = ""
    try { text = readFileSync(f.abs, "utf8") } catch { text = "" }
    try { r = await parseFile(f.abs, f.dir) } catch { failed++; continue }
    parsed++
    const label = `${f.repo}/${f.rel}`
    const symbols: any[] = r?.symbols ?? []
    const rels: any[] = r?.relationships ?? []
    totalSyms += symbols.length
    totalRels += rels.length

    // D7 — relationships the PRODUCTION PATH DISCARDS after the analyzer ran.
    //
    // `parseFile` hands the analyzer's output through `filterNoiseRelationships`
    // before returning, so an edge can exist in the analyzer and be gone by the time
    // anything downstream sees it. That is the same class as D1 one stage later, and
    // it would be invisible to every measurement that calls `analyze()` directly —
    // which is what `python-truth-diff.ts` does. The filter is called here with the
    // same arguments `parseFile` uses, so this measures the store's rule rather than a
    // transcription of it.
    //
    // It is ZERO on both corpora, and that is worth stating because the first
    // hypothesis was wrong and the measurement killed it: `NOISE_TARGETS` carries
    // `type`, `text` and `parent`, which are ordinary python attribute names, so it
    // looked like a likely source of the 7-edge gap between this lane's guess tally
    // (1,034) and the differential's (1,041). The gap is not a filter at all — it is
    // the FILE SET. This probe skips `test`, `tests`, `lib2to3`, `idlelib`,
    // `site-packages` and `testdata` and admits 548 stdlib files; `python-truth-diff.ts`
    // walks everything under the directory and admits 651. 1,041 − 1,034 = 7 guessed
    // edges in those 103 extra files. Recorded because a 7-edge discrepancy between
    // two instruments on the same corpus is exactly the kind of thing that gets
    // explained by a plausible story instead of by counting the files.
    const survived = filterNoiseRelationships(rels, "python", new Set(symbols.map((s: any) => String(s?.name ?? "")).filter(Boolean)))
    if (survived.length < rels.length) {
      const kept = new Set(survived)
      for (const rel of rels) {
        if (kept.has(rel)) continue
        const t = String(rel.type ?? rel.relationshipType ?? "").toLowerCase() as Type
        const src = String(rel.source ?? rel.from ?? "")
        const tgt = String(rel.target ?? rel.to ?? "")
        hit(D7, label, t, tgt, `${label} ${t} ${src} -> ${tgt} line ${rel.line_number ?? "none"} (filterNoiseRelationships discarded it)`, 40)
      }
    }

    // D6 — the symbol side of R7.
    for (const s of symbols) {
      const n = String(s?.name ?? "")
      if (n.trim() === "") { hit(D6empty, label, String(s?.kind ?? "?"), "(empty)", `${label} empty symbol name kind=${s?.kind}`); continue }
      if (isPlaceholderShape(n)) hit(D6placeholder, label, String(s?.kind ?? "?"), n, `${label} placeholder symbol ${n}`)
    }

    for (const rel of rels) {
      const t = String(rel.type ?? rel.relationshipType ?? "").toLowerCase() as Type
      const src = String(rel.source ?? rel.from ?? "")
      const tgt = String(rel.target ?? rel.to ?? "")
      // D3 — empty or whitespace-only endpoint.
      if (src.trim() === "" || tgt.trim() === "") {
        hit(D3, label, t, "(empty)", `${label} ${t} '${src}' -> '${tgt}' line ${rel.line_number ?? "none"}`)
      }
      // D1 — a contains edge into a name the PRODUCTION symbol filter deletes.
      //
      // `keepSymbol` is the production predicate, called on a shape it accepts
      // (`{name}`), so this is the store's own rule rather than a transcription of
      // it. The direction matters: the analyzer published the edge from a symbol
      // that existed, and the store then removed the symbol while keeping the edge.
      if (tgt !== "" && !keepSymbol({ name: tgt }, "python")) {
        hit(D1, label, t, tgt, `${label} ${t} ${src} -> ${tgt} line ${rel.line_number ?? "none"} (keepSymbol deletes '${tgt}')`)
      }
      // D2 — references into an interpreter builtin the analyzer does not filter.
      if (t === "references" && tgt !== "" && !ANALYZER_PRIMITIVES.has(tgt) && PY_BUILTIN_NAMES.has(tgt)) {
        hit(D2, label, t, tgt, `${label} references ${src} -> ${tgt} line ${rel.line_number ?? "none"}`)
      }
      // D4 — placeholder-literal endpoints, split by whether the file declares it.
      for (const [which, name] of [["src", src], ["tgt", tgt]] as Array<[string, string]>) {
        if (name === "" || !isPlaceholderShape(name)) continue
        if (text.includes(name)) hit(D4present, label, `${t}.${which}`, name, `${label} ${t} ${src} -> ${tgt} ('${name}' IS in the source)`)
        else hit(D4invented, label, `${t}.${which}`, name, `${label} ${t} ${src} -> ${tgt} ('${name}' is NOT in the source)`)
      }
      // D5 — a member read whose leaf is the reading function's own name.
      if (t === "uses" && src !== "" && src === tgt) {
        hit(D5, label, t, tgt, `${label} uses ${src} -> ${tgt} line ${rel.line_number ?? "none"}`)
      }
    }
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

// ---------------------------------------------------------------- report
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const top = (m: Map<string, number>, n = 10) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join("  ")

console.log(`python endpoint-defect probe — ${admitted.length} admitted, ${parsed} parsed, ${failed} failed`)
console.log(`corpus ${STDLIB ? STDLIB_DIR : REPO_FILTER ?? CR}   workers ${WORKERS}`)
console.log(`symbols ${totalSyms.toLocaleString()}  relationships ${totalRels.toLocaleString()}\n`)

const report = (id: string, d: Defect, what: string, cap = 8) => {
  console.log(`${w(id, 5)} ${d.count === 0 ? "0" : d.count.toLocaleString()}  ${what}`)
  if (d.count === 0) return
  console.log(`${w("", 5)} files ${d.files.size}   types ${top(d.byType, 6)}`)
  console.log(`${w("", 5)} names ${top(d.byName, 10)}`)
  for (const s of d.samples.slice(0, cap)) console.log(`${w("", 7)}${s}`)
}

report("D1", D1, "edges naming a symbol the PRODUCTION path deletes (pool-worker keepSymbol UNIVERSAL denylist)")
report("D2", D2, "references edges into an interpreter builtin outside the analyzer's 11-name primitive list")
report("D3", D3, "edges with an empty or whitespace-only endpoint")
report("D4a", D4invented, "placeholder-literal endpoints ABSENT from the file (invented — R7)")
report("D4b", D4present, "placeholder-literal endpoints PRESENT in the file (the RULE firing on real code)")
report("D5", D5, "uses self-loops (a member read whose leaf is the reading function's own name)")
report("D6a", D6empty, "symbols with an empty name")
report("D6b", D6placeholder, "symbols whose name is a placeholder literal")
report("D7", D7, "relationships the PRODUCTION path discards after analyze() (filterNoiseRelationships)", 12)

console.log(`\ndir(builtins) on this interpreter: ${PY_BUILTIN_NAMES.size} names; the analyzer filters ${ANALYZER_PRIMITIVES.size} of them as references targets`)
console.log(`heuristic share (confidence < 0.7) is measured by python-endpoint-resolution.ts, per type`)

if (OUT) {
  const ser = (d: Defect) => ({
    count: d.count, files: d.files.size,
    byType: Object.fromEntries(d.byType), byName: Object.fromEntries([...d.byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)),
    samples: d.samples,
  })
  writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(), corpus: STDLIB ? STDLIB_DIR : REPO_FILTER ?? CR,
    filesParsed: parsed, filesFailed: failed, totalSymbols: totalSyms, totalRelationships: totalRels,
    builtinNames: PY_BUILTIN_NAMES.size, analyzerPrimitives: [...ANALYZER_PRIMITIVES],
    D1_containsIntoDeletedSymbol: ser(D1),
    D2_referencesIntoInterpreterBuiltin: ser(D2),
    D3_emptyEndpoint: ser(D3),
    D4a_placeholderInvented: ser(D4invented),
    D4b_placeholderPresentInSource: ser(D4present),
    D5_usesSelfLoop: ser(D5),
    D6a_emptySymbolName: ser(D6empty),
    D6b_placeholderSymbolName: ser(D6placeholder),
    D7_discardedByProductionPath: ser(D7),
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}