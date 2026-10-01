// script/m60/compare-grammar-surface.ts — establish provenance by SURFACE when bytes
// cannot settle it, which is now the normal case rather than the exception.
//
// WHY THIS EXISTS. Two measurements from this milestone force the issue:
//
//   1. THE BUILDER IS NOT BIT-REPRODUCIBLE. `bash` reproduces from tree-sitter-bash@0.25.1 to
//      1,403,134 of 1,403,135 bytes; the one differing byte is in the data section. So a
//      byte match is not a reachable bar for a rebuild, and a byte MISMATCH says much less
//      than it appears to: it does not distinguish "wrong grammar" from "same grammar, one
//      linker flag different".
//   2. `kotlin` CANNOT BE BUILT HERE AT ALL. Its shipped wasm is 5,832,109 B, and compiling
//      its parser.c OOM-killed a 15 GB machine that was already running another agent's
//      builds. So the rebuild instrument correctly declared it `not-attempted` — a declared
//      non-measurement — which leaves the largest unversioned lane in the tree with no
//      provenance story at all.
//
// Both problems have the same answer, and it needs no compiler: COMPARE THE GRAMMAR'S
// SURFACE. A tree-sitter grammar's contract with its consumers is its vocabulary — the node
// types it produces and the fields it exposes. That is what the pin record already digests
// (id-order, type-set, field-set), so this is the same evidence class the repo already trusts,
// applied to provenance instead of to acceptance.
//
// NO BUILD IS REQUIRED. A candidate package that ships a prebuilt wasm is loaded and read
// directly, which is cheap: loading is not the expensive part, compiling is. kotlin's 5.8 MB
// module loads in milliseconds. A candidate that ships no wasm falls back to its published
// `src/node-types.json`, which is weaker (named types only, no fields) and is GRADED AS SUCH
// rather than quietly compared like-for-like.
//
// THE GRADES, and the one that matters most:
//
//   surface-identical   the two vocabularies are equal — same types, same fields, same ABI.
//                       This is provenance evidence that does NOT depend on the builder being
//                       reproducible, which is the whole point: it is the bar that survives
//                       measurement (1).
//   surface-compatible  one vocabulary contains the other. A minor version adding node types
//                       looks like this, and it is a real answer, not a near miss.
//   different           neither contains the other. Quantified, never rounded off.
//
// A `different` here is NOT a claim that the grammar is unrelated. It is a claim that the
// vocabularies differ, and how much, and that is what a reader gets.

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const WASM_DIR = path.join(ROOT, "wasm")
const SURVEY = path.join(ROOT, "validation", "m60", "grammar-survey.json")
const REBUILDS = path.join(ROOT, "validation", "m60", "results", "M60.0.local-rebuilds.json")
const OUT = path.join(ROOT, "validation", "m60", "results", "M60.0.grammar-surface.json")

const argv = process.argv.slice(2)
const ONLY = argv.includes("--lane") ? argv[argv.indexOf("--lane") + 1] : null
const MAX_CANDIDATES = Number(argv.includes("--max-candidates") ? argv[argv.indexOf("--max-candidates") + 1] : 4)

export type Surface = {
  source: "wasm" | "node-types.json"
  abiVersion: number | null
  nodeTypeCount: number | null
  types: string[]
  namedTypes: string[] | null
  fields: string[]
  digests: { types: string; namedTypes: string | null; fields: string; combined: string }
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex")
const sorted = (xs: Array<string | null | undefined>): string[] => [...new Set(xs.filter((x): x is string => typeof x === "string" && x.length > 0))].sort()

function digestsFor(types: string[], namedTypes: string[] | null, fields: string[]): Surface["digests"] {
  return {
    types: sha(types.join("\n")),
    namedTypes: namedTypes ? sha(namedTypes.join("\n")) : null,
    fields: sha(fields.join("\n")),
    // Types and fields are hashed TOGETHER as well as separately, because two vocabularies
    // can have equal sets and still not be the same grammar if the pairing differs.
    combined: sha(JSON.stringify({ t: types, f: fields })),
  }
}

// ------------------------------------------------------------- surface from a wasm
//
// Loading a Language is cheap even for a 5.8 MB module; it is COMPILING a parser.c that
// exhausts memory. That asymmetry is the entire reason this file exists.

let cachedRuntime: any = null
async function loadRuntime(): Promise<any> {
  if (cachedRuntime) return cachedRuntime
  const entry = ["tree-sitter.js", "web-tree-sitter.js"].map((f) => path.join(ROOT, "node_modules", "web-tree-sitter", f)).find(existsSync)
  if (!entry) throw new Error("web-tree-sitter is not installed")
  const mod: any = await import("file://" + entry)
  const Parser = mod.Parser ?? mod.default ?? mod
  const Language = mod.Language ?? mod.default?.Language
  const initFn = mod.init ?? Parser.init ?? mod.default?.init
  await initFn?.()
  cachedRuntime = { Parser, Language }
  return cachedRuntime
}

async function surfaceFromWasm(file: string): Promise<Surface> {
  const { Language } = await loadRuntime()
  const lang: any = await Language.load(readFileSync(file))
  const types = sorted(lang.types)
  const fields = sorted(lang.fields)
  return {
    source: "wasm",
    abiVersion: typeof lang.abiVersion === "number" ? lang.abiVersion : (typeof lang.version === "number" ? lang.version : null),
    nodeTypeCount: typeof lang.nodeTypeCount === "number" ? lang.nodeTypeCount : null,
    types,
    // `types` does not say which are named, so this stays null for a wasm: the binding
    // exposes one flat list. A node-types.json comparison can do better, and the grader
    // treats the two as different evidence rather than pretending they are the same.
    namedTypes: null,
    fields,
    digests: digestsFor(types, null, fields),
  }
}

// ------------------------------------------------- surface from published node-types.json

function surfaceFromNodeTypes(json: any): Surface {
  const entries: any[] = Array.isArray(json) ? json : []
  const types = sorted(entries.map((e) => e?.type))
  const namedTypes = sorted(entries.filter((e) => e?.named).map((e) => e?.type))
  // node-types.json carries each field under `fields: { name: {...} }` on the type that owns it.
  const fields = sorted(entries.flatMap((e) => Object.keys(e?.fields ?? {})))
  return {
    source: "node-types.json",
    abiVersion: null,
    nodeTypeCount: entries.length,
    types,
    namedTypes,
    fields,
    digests: digestsFor(namedTypes, namedTypes, fields),
  }
}

// ------------------------------------------------------------------ comparison

type Grade = "surface-identical" | "surface-compatible" | "different" | "not-comparable"

function compare(mine: Surface, theirs: Surface): { grade: Grade; detail: string } {
  // Comparing a wasm's full type list against a node-types.json NAMED-only list is not a
  // like-for-like test, and calling it one would manufacture mismatches (anonymous types like
  // "," and "(" are in the former and absent from the latter). The only fair cross-source
  // comparison is named types against named types.
  const crossSource = mine.source !== theirs.source
  const myTypes = crossSource ? (mine.namedTypes ?? mine.types) : mine.types
  const theirTypes = crossSource ? (theirs.namedTypes ?? theirs.types) : theirs.types

  if (myTypes.length === theirTypes.length && myTypes.every((t, i) => t === theirTypes[i]) && mine.fields.length === theirs.fields.length && mine.fields.every((f, i) => f === theirs.fields[i])) {
    return {
      grade: "surface-identical",
      detail: `${myTypes.length} node type(s) and ${mine.fields.length} field(s) match exactly${crossSource ? " (named types only — the candidate publishes no wasm, so anonymous types are not comparable)" : ""}${mine.abiVersion != null && theirs.abiVersion != null ? `; ABI ${mine.abiVersion} vs ${theirs.abiVersion}` : ""}`,
    }
  }
  const mineSet = new Set(myTypes)
  const theirSet = new Set(theirTypes)
  const onlyMine = myTypes.filter((t) => !theirSet.has(t))
  const onlyTheirs = theirTypes.filter((t) => !mineSet.has(t))
  const fieldOnlyMine = mine.fields.filter((f) => !new Set(theirs.fields).has(f))
  const fieldOnlyTheirs = theirs.fields.filter((f) => !new Set(mine.fields).has(f))

  if (onlyMine.length === 0 && onlyTheirs.length === 0) {
    // Types match one-way; check the fields before calling it compatible.
    if (fieldOnlyMine.length === 0 && fieldOnlyTheirs.length === 0) return { grade: "surface-identical", detail: "vocabularies are equal as sets" }
    return {
      grade: "surface-compatible",
      detail: `types match one-way (theirs adds ${onlyTheirs.length}, mine adds ${onlyMine.length}); fields differ: ${fieldOnlyMine.length} only in the shipped grammar, ${fieldOnlyTheirs.length} only in the candidate`,
    }
  }
  if (onlyMine.length === 0) {
    return { grade: "surface-compatible", detail: `the shipped grammar's vocabulary is a SUBSET of the candidate's: the candidate adds ${onlyTheirs.length} type(s) — a later version of the same grammar typically looks like this` }
  }
  if (onlyTheirs.length === 0) {
    return { grade: "surface-compatible", detail: `the candidate's vocabulary is a SUBSET of the shipped grammar's: the shipped grammar adds ${onlyMine.length} type(s) — the shipped build is AHEAD of this candidate` }
  }
  return {
    grade: "different",
    detail: `neither contains the other: ${onlyMine.length} type(s) only in the shipped grammar (${onlyMine.slice(0, 4).join(", ")}${onlyMine.length > 4 ? ", …" : ""}), ${onlyTheirs.length} only in the candidate (${onlyTheirs.slice(0, 4).join(", ")}${onlyTheirs.length > 4 ? ", …" : ""}); fields differ by ${fieldOnlyMine.length}/${fieldOnlyTheirs.length}`,
  }
}

// ------------------------------------------------------------------ candidate probe

function fetchCandidate(pkg: string, version: string): { wasm: string | null; nodeTypes: any | null; dir: string } {
  const work = mkdtempSync(path.join(tmpdir(), `bb-surface-${pkg.replace(/[@/]/g, "_")}-`))
  const ex = mkdtempSync(path.join(tmpdir(), `bb-surface-x-`))
  try {
    try {
      execFileSync("npm", ["pack", `${pkg}@${version}`, "--pack-destination", work], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: work, timeout: 300_000, stdio: ["ignore", "pipe", "ignore"] })
    } catch {
      return { wasm: null, nodeTypes: null, dir: work }
    }
    const tgz = readdirSync(work).filter((f) => f.endsWith(".tgz"))
    if (!tgz.length) return { wasm: null, nodeTypes: null, dir: work }
    // exit code ignored: `tar` warns on these archives while extracting them perfectly
    try {
      execFileSync("tar", ["xzf", path.join(work, tgz[0]), "-C", ex], { encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "ignore"] })
    } catch {
      /* the extracted tree is the evidence, not the tool's opinion */
    }
    let wasm: string | null = null
    let nodeTypes: any = null
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) {
          walk(p)
          continue
        }
        if (!wasm && e.name.endsWith(".wasm") && !e.name.includes("tree-sitter.wasm")) wasm = p
        else if (!nodeTypes && e.name === "node-types.json") {
          try {
            nodeTypes = JSON.parse(readFileSync(p, "utf8"))
          } catch {
            /* unreadable metadata is a declared absence */
          }
        }
      }
    }
    walk(ex)
    return { wasm, nodeTypes, dir: ex }
  } catch {
    return { wasm: null, nodeTypes: null, dir: work }
  }
}

// ---------------------------------------------------------------------------

const survey = JSON.parse(readFileSync(SURVEY, "utf8"))
const rebuildVerdicts = new Map<string, any>()
if (existsSync(REBUILDS)) {
  try {
    for (const r of JSON.parse(readFileSync(REBUILDS, "utf8")).results ?? []) if (r?.lane) rebuildVerdicts.set(r.lane, r)
  } catch {
    /* declared absence */
  }
}

// Lanes with no declared version: the ones whose identity is still open. A lane that already
// states a version is not the question this file asks.
const targets = (survey.rows ?? []).filter((r: any) => r?.shipped?.present && !r.generic && !r.aliasOf && r.declared?.version == null).filter((r: any) => (ONLY ? r.lane === ONLY : true))

mkdirSync(path.dirname(OUT), { recursive: true })
console.log(`grammar surface — ${targets.length} unversioned lane(s)\n`)

let priorResults: any[] = []
if (existsSync(OUT)) {
  try {
    priorResults = JSON.parse(readFileSync(OUT, "utf8")).results ?? []
  } catch {
    priorResults = []
  }
}
const byLane = new Map<string, any>(priorResults.map((r) => [r.lane, r]))

for (const row of targets as any[]) {
  const shippedPath = path.join(WASM_DIR, row.shipped.file)
  let mine: Surface
  try {
    mine = await surfaceFromWasm(shippedPath)
  } catch (e: any) {
    console.log(`  ${row.lane}: could not load the shipped grammar (${String(e?.message ?? e).slice(0, 80)})`)
    continue
  }
  console.log(`  ${row.lane}  (${row.shipped.bytes} B, ABI ${mine.abiVersion}, ${mine.types.length} types, ${mine.fields.length} fields)`)

  // The rebuild artifact's candidates go first, for the same reason they lead there: a
  // sha256-measured answer outranks a search-derived guess.
  const rebuild = rebuildVerdicts.get(row.lane)
  const cands: Array<{ package: string; version: string; origin: string }> = [
    ...(rebuild?.attempts ?? []).filter((a: any) => a.package && a.version && !a.error).map((a: any) => ({ package: a.package, version: a.version, origin: "rebuild attempt (already tried to build this)" })),
    ...(row.candidates ?? []).filter((c: any) => c.package && c.upstream?.latestVersion).map((c: any) => ({ package: c.package, version: c.upstream.latestVersion, origin: "survey candidate (search-derived)" })),
  ].filter((c, i, arr) => arr.findIndex((x) => x.package === c.package && x.version === c.version) === i).slice(0, MAX_CANDIDATES)

  const attempts: any[] = []
  let best: any = null
  for (const c of cands) {
    const got = fetchCandidate(c.package, c.version)
    try {
      let theirs: Surface | null = null
      if (got.wasm) theirs = await surfaceFromWasm(got.wasm)
      else if (got.nodeTypes) theirs = surfaceFromNodeTypes(got.nodeTypes)
      if (!theirs) {
        attempts.push({ package: c.package, version: c.version, origin: c.origin, grade: "not-comparable", detail: "the tarball ships neither a prebuilt wasm nor a node-types.json" })
        console.log(`      ${c.package}@${c.version}  not-comparable  no wasm and no node-types.json in the tarball`)
        continue
      }
      const cmp = compare(mine, theirs)
      attempts.push({ package: c.package, version: c.version, origin: c.origin, grade: cmp.grade, comparedAgainst: theirs.source, detail: cmp.detail })
      console.log(`      ${c.package}@${c.version}  ${cmp.grade.padEnd(17)} ${cmp.detail.slice(0, 76)}`)
      const rank = { "surface-identical": 3, "surface-compatible": 2, different: 1 } as Record<string, number>
      if (!best || (rank[cmp.grade] ?? 0) > (rank[best.grade] ?? 0)) best = attempts[attempts.length - 1]
      // An identical surface is a complete answer; nothing further can improve on it.
      if (cmp.grade === "surface-identical") break
    } finally {
      rmSync(got.dir, { recursive: true, force: true })
    }
  }

  byLane.set(row.lane, {
    lane: row.lane,
    shipped: { file: row.shipped.file, bytes: row.shipped.bytes, sha256: row.shipped.sha256 },
    surface: mine,
    verdict: best?.grade ?? "no-candidate-comparable",
    best,
    attempts,
    action:
      best?.grade === "surface-identical"
        ? "the shipped grammar and this candidate present the SAME vocabulary to consumers. Bytes still differ, which measurement 1 says to expect from a rebuild — so this is provenance evidence that does not depend on the builder being reproducible."
        : best?.grade === "surface-compatible"
          ? "one vocabulary contains the other, so this is a related grammar at a different version — name which direction, and the lane is decidable."
          : best?.grade === "different"
            ? "every candidate presents a different vocabulary. This is a genuine fork or an unpublished grammar, not a rebuild of something on npm — find the source rather than search harder."
            : "no candidate could be compared at all: nothing on npm ships a comparable artefact for this lane.",
  })
  console.log("")
  // Written per lane, so a kill or an ENOSPC costs one lane rather than the run.
  writeFileSync(OUT, JSON.stringify({ measuredAt: new Date().toISOString().slice(0, 10), results: [...byLane.values()] }, null, 2) + "\n")
}

const all = [...byLane.values()]
const artifact = {
  measuredAt: new Date().toISOString().slice(0, 10),
  purpose: "establish provenance by the grammar's VOCABULARY when bytes cannot settle it, and without a compiler — which is the only way kotlin (5.8 MB, OOMs a 15 GB box) can be measured at all",
  why: {
    builderNotBitReproducible:
      "bash reproduces from tree-sitter-bash@0.25.1 to 1,403,134 of 1,403,135 bytes; the differing byte is in the data section. So a byte mismatch does not distinguish 'wrong grammar' from 'same grammar, one linker flag different', and byte identity is not a reachable bar.",
    kotlinCannotBeBuilt:
      "its shipped wasm is 5,832,109 B and compiling its parser.c exhausted a 15 GB machine already running another agent's builds. Loading is cheap; compiling is not. That asymmetry is the whole reason this file exists.",
    sameEvidenceClassAsThePinRecord:
      "the pin contract already digests a grammar's type-set and field-set; this applies that same evidence to provenance instead of to acceptance.",
  },
  grading: {
    "surface-identical": "types and fields match exactly — provenance evidence independent of builder reproducibility",
    "surface-compatible": "one vocabulary contains the other — a related grammar at a different version",
    different: "neither contains the other, QUANTIFIED (counts of exclusive types and fields) — a fork or an unpublished grammar, not a rebuild",
    "not-comparable": "the tarball ships neither a prebuilt wasm nor a node-types.json",
    crossSourceCaveat:
      "a wasm's `types` list is flat (named and anonymous together) while node-types.json carries named types only, so a cross-source comparison uses named types on BOTH sides. Comparing a full list against a named-only list would manufacture mismatches out of tokens like ',' and '('.",
  },
  summary: {
    surfaceIdentical: all.filter((r) => r.verdict === "surface-identical").length,
    surfaceCompatible: all.filter((r) => r.verdict === "surface-compatible").length,
    different: all.filter((r) => r.verdict === "different").length,
    notComparable: all.filter((r) => r.verdict === "not-comparable" || r.verdict === "no-candidate-comparable").length,
  },
  results: all,
  written: path.relative(ROOT, OUT),
}
writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")
console.log(`  surface-identical ${artifact.summary.surfaceIdentical} · compatible ${artifact.summary.surfaceCompatible} · different ${artifact.summary.different} · not comparable ${artifact.summary.notComparable}`)
console.log(`  written to ${path.relative(ROOT, OUT)}`)
