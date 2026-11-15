/**
 * SCSS ONTOLOGY HARNESS — the arbiter for the SCSS lane.
 *
 * `script/m14/ontology-coverage-gate.ts` refuses to run a language with no ruling
 * table (`RULED_BY_LANG`), and `scss` has none, so the shared arbiter exits 2 with a
 * note about the TABLE rather than a verdict about the LANE. That table is shared
 * machinery this lane does not own (§8 of the workstream: report, do not edit), so
 * this harness is the lane-local arbiter and it reports the same four statuses with
 * the same two instruments. Its output is what the doc's per-type table cites.
 *
 * WHAT IT MEASURES, in this order:
 *   1. EMITTED census through the PRODUCTION entry point (`parseFile` from
 *      `src/ast/pool-worker.ts`, never `analyze()`): one row per relationship type
 *      with a count and file names.
 *   2. Symbol hygiene: `SymbolKind` tallies with empty/unknown called out, empty names
 *      counted, endpoints equal to the literal `unknown` counted.
 *   3. Resolution: both endpoints of every edge resolved against the file's own
 *      published symbol names, per relationship type.
 *   4. Confidence/evidence: edges under 0.7 counted separately per type.
 *   5. Instrument A — grammar inventory: every node type the wired SCSS grammar
 *      actually produces across the corpus.
 *   6. Instrument B — parse-tree semantic counts for the constructs a ruling would
 *      have to be silent about. A string literal and a comment cannot fake these.
 *
 * RE-RUN: `npx tsx script/m14/tmp/scss-ontology-harness.ts`
 * Writes nothing. Deterministic: no sampling, it reads every admitted corpus file.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = process.env.SCSS_HARNESS_OUT ?? path.join(process.cwd(), "script/m14/tmp/scss-ontology-harness.json")
const ALL_TYPES = ["calls", "uses", "contains", "brain_import", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
/** the ontology's 10, with `imports` under the wire value the graph stores */
const ONTOLOGY_10 = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ONTOLOGY_10)[number]

// ── corpus: every tracked file the router admits as `scss`, size-capped as the
// shared gate caps it, so the two instruments cover the same population.
const files: { repo: string; dir: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "scss") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
files.sort((a, b) => `${a.repo}/${a.rel}`.localeCompare(`${b.repo}/${b.rel}`))
const perRepoFiles = new Map<string, number>()
for (const f of files) perRepoFiles.set(f.repo, (perRepoFiles.get(f.repo) ?? 0) + 1)

// ── 1..4 the production census
type Edge = { source?: string; target?: string; from?: string; to?: string; type?: string; confidence?: number; line_number?: number; metadata?: Record<string, any> }
const edgeNames = (r: Edge): { s: string; t: string } => ({
  s: String(r.source ?? r.from ?? r.fromSymbol ?? ""),
  t: String(r.target ?? r.to ?? r.toSymbol ?? ""),
})

const relCounts = new Map<Type, number>()
const relFiles = new Map<Type, Set<string>>()
const relExamples = new Map<Type, string[]>()
const resolvedBoth = new Map<Type, number>()
const resolvedOne = new Map<Type, number>()
const lowConf = new Map<Type, number>()
const unknownEndpoint = new Map<Type, number>()
const evidenceByType = new Map<Type, Map<string, number>>()
const labelPairs = new Map<string, number>()
const kindCounts = new Map<string, number>()
let emptyNameSymbols = 0
let emptyKindSymbols = 0
let unknownKindSymbols = 0
let filesParsed = 0
let filesFailed = 0
let symbolTotal = 0
const perRepo = new Map<string, { files: number; ok: number; rels: number }>()
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch {
      filesFailed++
      continue
    }
    filesParsed++
    const row = perRepo.get(f.repo) ?? { files: 0, ok: 0, rels: 0 }
    row.files++
    row.ok++
    perRepo.set(f.repo, row)

    const names = new Set<string>()
    for (const s of (r.symbols ?? []) as any[]) {
      symbolTotal++
      const n = String(s?.name ?? "")
      if (n.trim().length === 0) emptyNameSymbols++
      if (typeof s?.kind !== "string" || s.kind.length === 0) emptyKindSymbols++
      else {
        kindCounts.set(s.kind, (kindCounts.get(s.kind) ?? 0) + 1)
        if (s.kind === "unknown") unknownKindSymbols++
      }
      names.add(n)
    }
    for (const rel of (r.relationships ?? []) as Edge[]) {
      const t = String(rel.type ?? "").toLowerCase() as (typeof ALL_TYPES)[number]
      if (!(ALL_TYPES as readonly string[]).includes(t)) continue
      const { s, tt } = { s: edgeNames(rel).s, tt: edgeNames(rel).t }
      const ontology = (t === "brain_import" ? "imports" : t) as Type
      relCounts.set(ontology, (relCounts.get(ontology) ?? 0) + 1)
      row.rels++
      const fs = relFiles.get(ontology) ?? new Set<string>()
      fs.add(label)
      relFiles.set(ontology, fs)
      const ex = relExamples.get(ontology) ?? []
      if (ex.length < 6) ex.push(`${label}: ${JSON.stringify(s)} -> ${JSON.stringify(tt)}`)
      relExamples.set(ontology, ex)
      const both = (s.length > 0 && tt.length > 0 && names.has(s) && names.has(tt)) ? 1 : 0
      const one = (s.length > 0 && tt.length > 0 && (names.has(s) || names.has(tt))) ? 1 : 0
      resolvedBoth.set(ontology, (resolvedBoth.get(ontology) ?? 0) + both)
      resolvedOne.set(ontology, (resolvedOne.get(ontology) ?? 0) + one)
      if (s === "unknown" || tt === "unknown") unknownEndpoint.set(ontology, (unknownEndpoint.get(ontology) ?? 0) + 1)
      const c = typeof rel.confidence === "number" ? rel.confidence : 1
      if (c < 0.7) lowConf.set(ontology, (lowConf.get(ontology) ?? 0) + 1)
      const ev = rel.metadata?.evidenceClass
      const evKey = typeof ev === "string" ? ev : "(none)"
      const em = evidenceByType.get(ontology) ?? new Map<string, number>()
      em.set(evKey, (em.get(evKey) ?? 0) + 1)
      evidenceByType.set(ontology, em)
      const pair = `${ontology} + ${JSON.stringify(String(rel.metadata?.isScssInclude ?? rel.metadata?.isScssExtend ?? rel.metadata?.isScssFunctionCall ?? rel.metadata?.isScssVarRef ?? "(delegated)"))}`
      labelPairs.set(pair, (labelPairs.get(pair) ?? 0) + 1)
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

// ── 5/6 the tree instruments
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-scss.wasm"))))

const grammarNodeTypes = new Map<string, number>()
const trees: any[] = []
for (const f of files) {
  const t = parser.parse(f.text)
  if (!t) continue
  trees.push({ label: `${f.repo}/${f.rel}`, root: t.rootNode, tree: t })
  const v = (n: any) => {
    grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(t.rootNode)
}

/** Instrument B: a semantic count on the tree. A string or a comment cannot produce these. */
type Probe = {
  key: string
  describe: string
  count: (root: any, label: string, hit: (m: string) => void) => void
}
const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.childCount; i++) out.push(n.child(i))
  return out
}
const named = (n: any): any[] => kids(n).filter((c) => c.isNamed)
const kidOf = (n: any, t: string): any | null => named(n).find((c) => c.type === t) ?? null
const collapse = (t: string): string => t.replace(/\s+/g, " ").trim()

const PROBES: Probe[] = [
  {
    key: "second-mixin-declaration",
    describe: "a SECOND `@mixin <name>` in the same file — it replaces the first (Sass: last wins)",
    count: (root, label, hit) => {
      const seen = new Set<string>()
      const v = (n: any) => {
        if (n.type === "mixin_statement") {
          const nm = n.childForFieldName?.("name") ?? kidOf(n, "identifier")
          const name = nm ? collapse(nm.text) : ""
          if (name) {
            if (seen.has(name)) hit(`${label}: @mixin ${name} redefined`)
            else seen.add(name)
          }
        }
        for (const c of kids(n)) v(c)
      }
      v(root)
    },
  },
  {
    key: "second-function-declaration",
    describe: "a SECOND `@function <name>` in the same file",
    count: (root, label, hit) => {
      const seen = new Set<string>()
      const v = (n: any) => {
        if (n.type === "function_statement") {
          const nm = n.childForFieldName?.("name") ?? kidOf(n, "identifier")
          const name = nm ? collapse(nm.text) : ""
          if (name) {
            if (seen.has(name)) hit(`${label}: @function ${name} redefined`)
            else seen.add(name)
          }
        }
        for (const c of kids(n)) v(c)
      }
      v(root)
    },
  },
  {
    key: "variable-assigned-twice",
    describe: "a `$var` assigned more than once in the same file (Sass reassignment)",
    count: (root, label, hit) => {
      const seen = new Set<string>()
      const v = (n: any) => {
        if (n.type === "declaration") {
          const p = kidOf(n, "property_name")
          const name = p ? p.text : ""
          if (name.startsWith("$")) {
            if (seen.has(name)) hit(`${label}: ${name} reassigned`)
            else seen.add(name)
          }
        }
        for (const c of kids(n)) v(c)
      }
      v(root)
    },
  },
  {
    key: "forward-statement",
    describe: "a `@forward` — the module system statement that re-exports another module's members",
    count: (root, label, hit) => {
      const v = (n: any) => {
        if (n.type === "forward_statement") {
          const m = kidOf(n, "string_value")
          hit(`${label}: @forward ${m ? m.text : "?"}`)
        }
        for (const c of kids(n)) v(c)
      }
      v(root)
    },
  },
  {
    key: "extend-statement",
    describe: "an `@extend` — the only inheritance-shaped construct Sass has",
    count: (root, label, hit) => {
      const v = (n: any) => {
        if (n.type === "extend_statement") hit(`${label}: ${collapse(n.text).slice(0, 60)}`)
        for (const c of kids(n)) v(c)
      }
      v(root)
    },
  },
  {
    key: "placeholder-selector-declared",
    describe: "a `%placeholder` selector DEFINED in a rule_set — Sass's own name for it is a placeholder that only becomes a selector once `@extend`ed",
    count: (root, label, hit) => {
      const v = (n: any) => {
        if (n.type === "rule_set") {
          const s = kidOf(n, "selectors")
          if (s && /(^|[\s,>+~])%[-\w]/.test(s.text)) hit(`${label}: ${collapse(s.text).slice(0, 60)}`)
        }
        for (const c of kids(n)) v(c)
      }
      v(root)
    },
  },
  {
    key: "call-expression-named-function",
    describe: "a `call_expression` whose callee is a `@function` this file DECLARES",
    count: (root, label, hit) => {
      const fns = new Set<string>()
      const v0 = (n: any) => {
        if (n.type === "function_statement") {
          const nm = n.childForFieldName?.("name") ?? kidOf(n, "identifier")
          if (nm) fns.add(collapse(nm.text))
        }
        for (const c of kids(n)) v0(c)
      }
      v0(root)
      const v = (n: any) => {
        if (n.type === "call_expression") {
          const f = kidOf(n, "function_name")
          if (f && fns.has(collapse(f.text))) hit(`${label}: ${collapse(f.text)}()`)
        }
        for (const c of kids(n)) v(c)
      }
      v(root)
    },
  },
  // The two instrument-A companions are NOT here, and that is deliberate. They were
  // written as SHAPE regexes (`/^(class|interface|struct|…)/`) and reported 64,744
  // occurrences, every one of them a `class_selector` or a `class_name` — a CSS selector's
  // own name, which has nothing to do with a type declaration. A shape regex cannot ask
  // "does this language HAVE the construct", which is the question instrument A exists for.
  // Instrument A for this lane is the node-type INVENTORY printed above, read by exact
  // name, and `script/m14/tmp/scss-ontology-probes.ts` is where that table is stated as
  // explicit names with an explicit per-name count (all zero for every supertype and
  // constructor name in 150 node types).
]

const probeHits = new Map<string, { n: number; files: Set<string>; examples: string[] }>()
for (const p of PROBES) {
  let total = 0
  const fileset = new Set<string>()
  const examples: string[] = []
  for (const { label, root } of trees) {
    const before = total
    p.count(root, label, (m) => {
      total++
      if (examples.length < 5) examples.push(m)
    })
    if (total > before) fileset.add(label)
  }
  probeHits.set(p.key, { n: total, files: fileset, examples })
}
for (const { tree } of trees) tree.delete?.()

// ── report
const L = (s: string) => console.log(s)
L(`SCSS ONTOLOGY HARNESS`)
L(`corpus root: ${CR}`)
L(`admitted scss files: ${files.length} across ${perRepoFiles.size} repos`)
L(`repos: ${[...perRepoFiles].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}=${n}`).join(", ")}`)
L(`parseFile: ok ${filesParsed}, threw ${filesFailed}`)
L(`symbols: ${symbolTotal}; empty names ${emptyNameSymbols}; empty kind ${emptyKindSymbols}; kind=="unknown" ${unknownKindSymbols}`)
L(`symbol kinds: ${[...kindCounts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ")}`)
L("")
L("── relationship census (production parseFile) ──")
L(`type          edges      files  both-ends-resolved  one-end  low-conf(<0.7)  unknown-endpoint`)
for (const t of ONTOLOGY_10) {
  const n = relCounts.get(t) ?? 0
  const b = resolvedBoth.get(t) ?? 0
  const o = resolvedOne.get(t) ?? 0
  const lc = lowConf.get(t) ?? 0
  const ue = unknownEndpoint.get(t) ?? 0
  const pct = n > 0 ? `${((b / n) * 100).toFixed(1)}% (${b}/${n})` : "n/a (0 edges)"
  L(`${t.padEnd(12)} ${String(n).padEnd(9)} ${String(relFiles.get(t)?.size ?? 0).padEnd(6)} ${pct.padEnd(21)} ${String(o).padEnd(8)} ${String(lc).padEnd(16)} ${ue}`)
}
L("")
L("── evidence class per type ──")
for (const t of ONTOLOGY_10) {
  const em = evidenceByType.get(t)
  if (!em || em.size === 0) continue
  L(`${t}: ${[...em].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", ")}`)
}
L("")
L("── label x marker pairs (which SCSS construct carries which label) ──")
for (const [k, v] of [...labelPairs].sort((a, b) => b[1] - a[1])) L(`${String(v).padStart(7)}  ${k}`)
L("")
L("── instrument A: grammar inventory (node types the wired grammar produces) ──")
L(`distinct node types: ${grammarNodeTypes.size}`)
L([...grammarNodeTypes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(", "))
L("")
L("── instrument B: parse-tree semantic counts ──")
for (const p of PROBES) {
  const h = probeHits.get(p.key)!
  L(`${p.key.padEnd(34)} occurrences=${String(h.n).padStart(6)}  files=${String(h.files.size).padStart(4)}  ${p.describe}`)
  for (const ex of h.examples) L(`      ${ex}`)
}
L("")
L("── per repo ──")
for (const [r, v] of [...perRepo].sort((a, b) => b[1].rels - a[1].rels)) L(`${r.padEnd(20)} files=${String(v.files).padStart(4)} ok=${String(v.ok).padStart(4)} rels=${v.rels}`)

if (OUT) {
  const payload = {
    corpus: { root: CR, files: files.length, repos: Object.fromEntries(perRepoFiles), parseOk: filesParsed, parseThrew: filesFailed },
    symbols: { total: symbolTotal, emptyNames: emptyNameSymbols, emptyKinds: emptyKindSymbols, unknownKind: unknownKindSymbols, kinds: Object.fromEntries(kindCounts) },
    relationships: Object.fromEntries(
      ONTOLOGY_10.map((t) => [
        t,
        {
          count: relCounts.get(t) ?? 0,
          files: [...(relFiles.get(t) ?? [])].sort(),
          bothResolved: resolvedBoth.get(t) ?? 0,
          oneResolved: resolvedOne.get(t) ?? 0,
          lowConfidence: lowConf.get(t) ?? 0,
          unknownEndpoint: unknownEndpoint.get(t) ?? 0,
          evidenceClass: Object.fromEntries(evidenceByType.get(t) ?? new Map()),
          examples: relExamples.get(t) ?? [],
        },
      ]),
    ),
    instrumentA: { distinctNodeTypes: grammarNodeTypes.size, nodeTypes: Object.fromEntries(grammarNodeTypes) },
    instrumentB: Object.fromEntries(PROBES.map((p) => [p.key, { occurrences: probeHits.get(p.key)!.n, files: [...probeHits.get(p.key)!.files].sort(), examples: probeHits.get(p.key)!.examples, describes: p.describe }])),
    labelPairs: Object.fromEntries(labelPairs),
  }
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`)
  L(`\nwrote ${OUT}`)
}