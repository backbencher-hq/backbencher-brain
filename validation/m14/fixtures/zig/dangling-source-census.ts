/**
 * ZIG DANGLING-SOURCE CENSUS — which edges carry a `source` that names no symbol.
 *
 * ## Why this is a separate instrument
 *
 * `ontology-census.ts` reports the DANGLING RATE per type, which answers "how
 * much" and not "why". A rate with no cause is a number a reader has to trust,
 * and this lane found two distinct causes that need different fixes, so they are
 * separated here rather than averaged together.
 *
 * ## The measurement
 *
 * For every `calls` / `uses` / `instantiates` edge whose `source` is neither a
 * scope marker (`(global)`, `(file)`, …) nor a symbol published by the same
 * file, the SOURCE NAME is classified by asking the PARSE TREE what declaration
 * it belongs to:
 *
 *   member-of-unpublished-container  the name is a `function_declaration` whose
 *                                   nearest container ancestor is LOCAL (inside
 *                                   a function/test/comptime body) or ANONYMOUS.
 *                                   The analyzer publishes no symbol for such a
 *                                   member by contract (Z22), so the edge names a
 *                                   declaration the index does not hold.
 *   named-test                      the name is the identifier of a
 *                                   `test_declaration`. `test foo { }` is a NAMED
 *                                   scope (Z39) and edges inside it are attributed
 *                                   to `foo` — but the analyzer publishes no symbol
 *                                   for a test, so the same mismatch arises by a
 *                                   different route.
 *   comptime-block                  the name is the identifier of a
 *                                   `comptime_declaration`.
 *
 * ## Calibration
 *
 * Controls run through the SAME tree walk: a synthetic local container, a
 * synthetic anonymous container, a synthetic named test and a synthetic
 * comptime block. A class that reports 0 everywhere is indistinguishable from a
 * class that cannot see, so each of the four controls must find its own shape,
 * and a negative control must read 0.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/dangling-source-census.ts [--sample 800] [--seed s] [--out p]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Parser, Language } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const SAMPLE = Number(arg("sample", "800"))
const SEED = arg("seed", "dangling-source-census-v1")
const OUT = arg("out", "")

await Parser.init({
  locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const language: any = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-zig.wasm")))
const parser = new Parser()
parser.setLanguage(language)

// ───────────────────────────────────────────── corpus
type FileRec = { repo: string; rel: string; abs: string; text: string }
const all: FileRec[] = []
const repoFileCounts: Record<string, number> = {}
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.zig"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  repoFileCounts[e] = tracked.length
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    all.push({ repo: e, rel, abs, text: "" })
  }
}
const key = (f: FileRec) => `${f.repo}/${f.rel}`
for (const f of all) {
  try { f.text = readFileSync(f.abs, "utf8") } catch { f.text = "" }
}
const hashed = all
  .map((f) => ({ f, h: createHash("sha256").update(`${SEED}|${key(f)}`).digest("hex") }))
  .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
  .map((x) => x.f)
const draw = SAMPLE > 0 && SAMPLE < hashed.length ? hashed.slice(0, SAMPLE) : hashed
const drawHash = createHash("sha256").update(draw.map(key).sort().join("\n")).digest("hex")

// ───────────────────────────────────────────── the classifier
const CONTAINER_NODES = new Set([
  "struct_declaration", "union_declaration", "enum_declaration",
  "error_set_declaration", "opaque_declaration",
])
/** Container ancestors whose members the analyzer publishes: a NAMED container
 *  bound to an identifier at file scope. Anything else is local or anonymous. */
const PUBLISHED_ENCLOSING_BODY = new Set(["variable_declaration"])

type Class = "published-file-scope" | "member-of-unpublished-container" | "named-test" | "comptime-block"

const isPublishedContainerBinding = (n: any): boolean => {
  const p = n.parent
  if (!p || p.type !== "variable_declaration") return false
  if (!p.namedChildren?.some((c: any) => c.type === "identifier")) return false
  // Named is not enough: `const S = struct { … }` written INSIDE a function body
  // or a test is a named LOCAL container, and the analyzer publishes nothing for
  // it either. The binding counts as published only at FILE scope — no enclosing
  // function, test, comptime block or other container between it and the root.
  // The first version of this classifier stopped at the identifier and misfiled
  // every local container as published (`doTheTest` inside a `test`, `f` inside
  // `setupFd`), which would have hidden the whole class this census exists to
  // measure.
  let cur: any = p.parent
  while (cur) {
    if (cur.type === "function_declaration" || cur.type === "test_declaration" || cur.type === "comptime_declaration") return false
    if (CONTAINER_NODES.has(cur.type)) return false
    cur = cur.parent
  }
  return true
}
/** Walk UP from a declaration node to its nearest container ancestor and decide
 *  whether that container is one the analyzer publishes a symbol for. */
function containerIsPublished(n: any): boolean {
  let cur = n.parent
  while (cur) {
    if (CONTAINER_NODES.has(cur.type)) return isPublishedContainerBinding(cur)
    cur = cur.parent
  }
  // No container ancestor at all: a top-level `fn` is published.
  return true
}

/** Classify every dangling source NAME in one file's source text, by the
 *  DECLARATIONS that bear the name. A name can be borne by several (shadowing, or
 *  a helper repeated across the returned structs of two generic functions), so the
 *  value is a SET: counting only the strongest class UNDER-counts `named-test`
 *  whenever an unpublished member shares the spelling, and an under-count that
 *  reads as zero is worse than a larger honest number. Per-class counts therefore
 *  sum to more than the dangling total, and `namesWithMultipleClasses` says by how
 *  much. */
function classifyNames(text: string): Map<string, Set<Class>> {
  const out = new Map<string, Set<Class>>()
  const t = parser.parse(text)
  if (!t) return out
  const visit = (n: any): void => {
    if (n.type === "function_declaration" || n.type === "test_declaration" || n.type === "comptime_declaration") {
      const id = n.namedChildren?.find((c: any) => c.type === "identifier")
      if (id) {
        const nm = String(id.text)
        const cls: Class =
          n.type === "test_declaration" ? "named-test"
            : n.type === "comptime_declaration" ? "comptime-block"
              : containerIsPublished(n) ? "published-file-scope" : "member-of-unpublished-container"
        // A name can be borne by more than one declaration in a file (shadowing);
        // the strongest claim wins, so a member of an unpublished container is
        // never relabelled because another declaration shares the spelling.
        let set = out.get(nm)
        if (!set) { set = new Set(); out.set(nm, set) }
        set.add(cls)
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) visit(c)
    }
  }
  visit(t.rootNode)
  t.delete?.()
  return out
}

// ───────────────────────────────────────────── controls, through the SAME walk
const controlSrc: { name: string; src: string; probe: string; expect: Class | null }[] = [
  {
    name: "a method of a LOCAL container is unpublished",
    src: "fn outer() type {\n    return struct {\n        fn next(self: *Self) void { _ = self; }\n    };\n}\n",
    probe: "next",
    expect: "member-of-unpublished-container",
  },
  {
    name: "a method of an ANONYMOUS returned container is unpublished",
    src: "fn outer() type {\n    return struct {\n        fn inside(self: *Self) void { _ = self; }\n    };\n}\n",
    probe: "inside",
    expect: "member-of-unpublished-container",
  },
  {
    name: "a method of a NAMED file-scope container IS published",
    src: "const S = struct {\n    fn member(self: *Self) void { _ = self; }\n};\n",
    probe: "member",
    expect: "published-file-scope",
  },
  {
    name: "a top-level fn IS published",
    src: "fn toplevel() void {}\n",
    probe: "toplevel",
    expect: "published-file-scope",
  },
  {
    name: "a NAMED test is named-test",
    src: "fn helper() void {}\ntest helper { helper(); }\n",
    probe: "helper",
    expect: "named-test",
  },
  {
    // NEGATIVE, and the reason the class exists at all: a `comptime` block
    // carries no identifier of its own, so it can never BE a source name. The
    // classifier has a branch for it; this control pins that branch at zero
    // rather than leaving it to look exercised.
    name: "NEGATIVE: a comptime block bears no name, so it can never be a source",
    src: "const K = comptime blk: void = { _ = 0; };\n",
    probe: "blk",
    expect: null,
  },
  {
    name: "a named container inside a FUNCTION BODY is unpublished",
    src: "fn outer() void {\n    const S = struct {\n        fn member() void {}\n    };\n    S.member();\n}\n",
    probe: "member",
    expect: "member-of-unpublished-container",
  },
  {
    name: "NEGATIVE: a name no declaration bears is not classified",
    src: "fn real() void {}\n",
    probe: "imaginary",
    expect: null,
  },
]
const controlResults: Record<string, { found: string | null; expected: Class | null; ok: boolean; source: string }> = {}
for (const c of controlSrc) {
  const set = classifyNames(c.src).get(c.probe)
  const found: string | null = set && set.size === 1 ? [...set][0]! : set && set.size > 1 ? [...set].join("+") : null
  controlResults[c.name] = {
    found, expected: c.expect,
    ok: c.expect === null ? found === null : found === c.expect,
    source: c.src.replace(/\n/g, " | "),
  }
}

// ───────────────────────────────────────────── the corpus walk
const MARKERS = new Set(["(global)", "(file)", "(declared-type)", "(module)", "(package)"])
const TYPES = ["calls", "uses", "instantiates"]
const RESIDUAL = "not-a-declaration-on-the-tree"
const CLASSES: Class[] = ["member-of-unpublished-container", "named-test", "comptime-block", "published-file-scope", RESIDUAL]
const counts: Record<string, number> = { edges: 0, dangling: 0, ...Object.fromEntries(CLASSES.map((c) => [c, 0])) }
const perType: Record<string, { edges: number; dangling: number; byClass: Record<string, number> }> = {}
for (const t of TYPES) perType[t] = { edges: 0, dangling: 0, byClass: {} }
const examples: Record<string, string[]> = Object.fromEntries(CLASSES.map((c) => [c, []])) as Record<string, string[]>
const danglingNames = new Map<string, number>()
let multiClassNames = 0
let filesParsed = 0
let parseFailures = 0
const perRepo: Record<string, { files: number; dangling: number }> = {}

for (const f of draw) {
  let r: any
  try { r = await parseFile(f.abs, f.abs.replace(/\/[^/]+$/, "")) } catch { parseFailures++; continue }
  filesParsed++
  const names = new Set<string>((r.symbols ?? []).map((s: any) => String(s.name ?? "")))
  const classified = classifyNames(f.text)
  perRepo[f.repo] = perRepo[f.repo] ?? { files: 0, dangling: 0 }
  perRepo[f.repo].files++
  for (const e of r.relationships ?? []) {
    const t = String(e.type ?? "")
    if (!TYPES.includes(t)) continue
    const src = String(e.source ?? "")
    counts.edges++
    perType[t].edges++
    if (MARKERS.has(src) || names.has(src)) continue
    counts.dangling++
    perType[t].dangling++
    perRepo[f.repo].dangling++
    const set = classified.get(src)
    const classes = set && set.size > 0 ? [...set] : [RESIDUAL]
    if (classes.length > 1) multiClassNames++
    for (const cls of classes) {
      counts[cls]++
      perType[t].byClass[cls] = (perType[t].byClass[cls] ?? 0) + 1
      if (examples[cls].length < 12) {
        examples[cls].push(`${key(f)}: ${t} ${src} -> ${String(e.target ?? "")} @line ${e.line_number ?? "?"}${classes.length > 1 ? ` [also: ${classes.filter((c) => c !== cls).join(", ")}]` : ""}`)
      }
    }
    danglingNames.set(src, (danglingNames.get(src) ?? 0) + 1)
  }
}

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 10000) / 100)

const report = {
  instrument: "validation/m14/fixtures/zig/dangling-source-census.ts",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  corpusRoot: CR,
  seed: SEED,
  samplingMethod: "git ls-files -- '*.zig' per corpus repo, ordered by sha256(seed|<repo>/<rel>), first N taken. Reproducible, not a statistical random sample.",
  corpusFileCounts: repoFileCounts,
  corpusFilesAdmitted: all.length,
  sampledFiles: draw.length,
  drawHash: `sha256:${drawHash}`,
  filesParsed,
  parseFailures,
  scopeMarkersTreatedAsNonDangling: [...MARKERS],
  typesMeasured: TYPES,
  totals: {
    edges: counts.edges,
    dangling: counts.dangling,
    danglingSourceNamesCarryingMoreThanOneClass: multiClassNames,
    perClassCountsNote: "a name borne by several declarations is counted under EACH class it carries, so byClass sums to more than dangling",
    danglingPct: pct(counts.dangling, counts.edges),
    byClass: Object.fromEntries(CLASSES.map((c) => [c, counts[c]])),
    byClassPctOfDangling: Object.fromEntries(CLASSES.map((c) => [c, pct(counts[c], counts.dangling)])),
  },
  perType: Object.fromEntries(TYPES.map((t) => [t, {
    edges: perType[t].edges,
    dangling: perType[t].dangling,
    danglingPct: pct(perType[t].dangling, perType[t].edges),
    byClass: perType[t].byClass,
  }])),
  perRepo,
  topDanglingSourceNames: [...danglingNames].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, c]) => `${n}=${c}`),
  examples,
  controls: controlResults,
}

const text = JSON.stringify(report, null, 2)
if (OUT) {
  writeFileSync(path.resolve(ROOT, OUT), text + "\n")
  console.log(`wrote ${OUT}`)
}
console.log(`zig dangling-source census — ${filesParsed} files parsed of ${draw.length} sampled (${all.length} admitted), draw ${report.drawHash}`)
console.log(`  edges measured ${counts.edges}   dangling sources ${counts.dangling} = ${report.totals.danglingPct}%`)
for (const c of CLASSES) console.log(`      ${String(counts[c]).padStart(7)}  ${c}  (${report.totals.byClassPctOfDangling[c]}% of dangling)`)
console.log("")
for (const t of TYPES) console.log(`  ${t.padEnd(14)} ${String(perType[t].edges).padStart(7)} edges  ${String(perType[t].dangling).padStart(6)} dangling = ${report.perType[t].danglingPct}%  ${JSON.stringify(perType[t].byClass)}`)
console.log("")
console.log("PER REPO")
for (const [r2, v] of Object.entries(perRepo)) console.log(`  ${r2.padEnd(18)} ${String(v.files).padStart(5)} files  ${String(v.dangling).padStart(6)} dangling`)
console.log("")
console.log("TOP DANGLING SOURCE NAMES")
for (const s of report.topDanglingSourceNames) console.log(`  ${s}`)
console.log("")
console.log("EXAMPLES")
for (const [k, v] of Object.entries(examples)) {
  console.log(`  ${k}:`)
  for (const e of v) console.log(`      ${e}`)
}
console.log("")
console.log("CONTROLS")
for (const [k, v] of Object.entries(controlResults)) console.log(`  ${v.ok ? "ok  " : "FAIL"} ${k.padEnd(58)} found ${String(v.found)} (expected ${String(v.expected)})`)
if (Object.values(controlResults).some((v) => !v.ok)) process.exitCode = 1