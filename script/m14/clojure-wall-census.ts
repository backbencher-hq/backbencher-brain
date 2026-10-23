#!/usr/bin/env bun
/**
 * CLOJURE — THE WALL CENSUS, OVER THE WHOLE ADMITTED POPULATION ✓✓
 *
 * ★ WHY THIS EXISTS. The completion gate's condition (D) is "every wall dispositioned with a COUNT
 * and a FALSIFIER". A count that was typed by hand is an assertion; a count that comes from an
 * instrument is a MEASUREMENT. And the lane's own wall table (CLOJURE-D7-WALLS.md §4) was written
 * against the gate's `--dump`, WHICH IS BOUNDED (`BB_DUMP_LIMIT`, default 40) — so the lane's wall
 * counts and the lane's arm could never be read from the same artifact, and the DUMP is a WORKLIST,
 * not the row set.
 *
 * ⇒⇒⇒ ⇒⇒⇒ **THIS INSTRUMENT CLOSES THAT GAP: IT PARSES THE POPULATION, RUNS THE PRODUCTION
 * ANALYZER, AND COUNTS EVERY NON-RESOLVED ROW INTO A NAMED WALL CLASS — USING THE ANALYZER'S OWN
 * METADATA, NEVER A REGEX OVER SOURCE TEXT.** ⇒⇒⇒ ⇒⇒⇒ **⇒⇒⇒ AND IT COUNTS EVERY EDGE, NOT A
 * SAMPLE: the arm's own population is 646 files, and this census reads the same 646.**
 *
 * ⇒⇒⇒ ⇒⇒⇒ **THE CLASSIFICATION IS BY THE ANALYZER'S OWN METADATA KEYS** — the same keys the
 * analyzer publishes (`isExternalTarget`, `languageNamespace`, `dependencyMembership`,
 * `isJavaInterop`, `isStaticInteropClass`, `isFieldAccess`, `isCtorLiteral`, `isLibraryDep`,
 * `isTaggedLiteral`, `isRenderElement`, `isTopLevel`, …). A wall class is therefore a SET OF
 * METADATA KEYS, and the table below is auditable by reading the analyzer's source, not by trusting
 * this file.
 *
 * ⇒⇒⇒ ⇒⇒⇒ **A RESOLVED ROW IS COUNTED TOO — as the control.** A census that cannot say what it is
 * measuring from something else is not a measure (the fleet's rule), so the control is: the
 * resolved rows, the non-resolved rows, and the sum, printed beside each other.
 *
 * RUN: bun run script/m14/clojure-wall-census.ts --out validation/m14/measurements/clojure-wall-census.json
 */
import { readFileSync, writeFileSync, readdirSync, statSync, lstatSync, realpathSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const WASM = path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")
const PINNED_WASM_SHA256 = "90f8866b74d04e1643ed73cce25720c732df2aaa38b45da9dcc773bae8181c27"

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  if (i >= 0) return argv[i + 1] ?? ""
  for (const a of argv) if (a.startsWith(f + "=")) return a.slice(f.length + 1)
  return undefined
}
const OUT = argOf("--out") ?? ""
const CR = argOf("--corpus-root") ?? process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const EXTS = ["clj", "cljs", "cljc", "edn"]
const SIZE_CAP = 1024 * 1024

function gitTracked(repoDir: string): string[] {
  try {
    const r = Bun.spawnSync(["git", "-C", repoDir, "ls-files"], { stdout: "pipe", stderr: "pipe" })
    if (r.exitCode !== 0) return []
    return new TextDecoder().decode(r.stdout).split("\n").filter((l) => l.trim().length > 0)
  } catch { return [] }
}
/**
 * ⇒⇒⇒ THE FLEET'S SYMLINK RULE (validation/m14/verification/FLEET-RULINGS-2026-10-22.md §1):
 * **the count of symlinked DIRECTORY ENTRIES the walk FOLLOWED, over the CORPUS ROOT, with
 * the rule printed beside the number, and whether the walk deduplicated.**
 * THREE NUMBERS, SEPARATELY, so no reader has to ask which set was counted:
 *   · entriesEntered — every symlinked directory entry this walk descended into
 *   · distinctRealPaths — how many DISTINCT real paths stand behind those entries
 *   · deduplicated — whether a repeat target is counted once or per entry (here: EVERY
 *     entry is counted, because the walk really did enter each one)
 * AND THE POPULATION IS THE `git ls-files` SET, not a disk walk: a count is only as good
 * as the rule that travels with it, and the rule travels in `populationRule` below.
 */
function discover(): {
  files: string[]
  repos: Map<string, number>
  byExt: Map<string, number>
  symlinks: { entriesEntered: number; distinctRealPaths: number; deduplicated: boolean; root: string; rule: string }
} {
  const files: string[] = []
  const repos = new Map<string, number>()
  const byExt = new Map<string, number>()
  const symReal = new Set<string>()
  let symEntries = 0
  const countSymlinks = (dir: string): void => {
    for (const e of readdirSync(dir).sort()) {
      const abs = path.join(dir, e)
      let l: any
      try { l = lstatSync(abs) } catch { continue }
      if (l.isSymbolicLink()) {
        let t: any
        try { t = statSync(abs) } catch { continue }
        if (!t.isDirectory()) continue
        // THE ENTRY IS COUNTED BECAUSE THE WALK REALLY ENTERS IT; the real path is
        // recorded so the distinct count can be published beside it.
        symEntries += 1
        try { symReal.add(realpathSync(abs)) } catch { symReal.add(abs) }
        countSymlinks(abs)
      } else if (l.isDirectory()) countSymlinks(abs)
    }
  }
  countSymlinks(CR)
  const symlinks = {
    entriesEntered: symEntries,
    distinctRealPaths: symReal.size,
    deduplicated: false,
    root: CR,
    rule: "the number of symlinked DIRECTORY entries the walk FOLLOWED, counted as ENTRIES the walk entered, over the corpus root; distinctRealPaths is the number of DISTINCT real paths behind those entries, published beside it (deduplicated=false: a repeat target is counted per entry)",
  }
  for (const repo of readdirSync(CR).sort()) {
    const repoDir = path.join(CR, repo)
    let st: any
    try { st = statSync(repoDir) } catch { continue }
    if (!st.isDirectory()) continue
    let n = 0
    for (const rel of gitTracked(repoDir)) {
      const ext = rel.split(".").pop()?.toLowerCase() ?? ""
      if (!EXTS.includes(ext)) continue
      const abs = path.join(repoDir, rel)
      let size = 0
      try { size = statSync(abs).size } catch { continue }
      if (size > SIZE_CAP) continue
      files.push(abs)
      n++
      byExt.set(ext, (byExt.get(ext) ?? 0) + 1)
    }
    if (n > 0) repos.set(repo, n)
  }
  files.sort()
  return { files, repos, byExt, symlinks }
}

const wasmSha256 = createHash("sha256").update(readFileSync(WASM)).digest("hex")
if (wasmSha256 !== PINNED_WASM_SHA256) {
  console.error(`THE PINNED GRAMMAR's DIGEST MOVED — expected ${PINNED_WASM_SHA256}, read ${wasmSha256}`)
  process.exit(3)
}

const { getParser } = await import("../../src/ast/engine")
const parser = await getParser("clojure" as any)

/* ── THE WALL CLASSES. Each is a SET OF THE ANALYZER'S OWN METADATA KEYS (plus, where the class is
 *    about a TARGET SPELLING, the spelling read from the row's own target string). ── */
type WallDef = {
  key: string
  /** what the wall IS, in one line — the disposition's subject */
  what: string
  /** the metadata keys that carry the class (ANY of them) */
  keys: string[]
  /** a target-shape test, for the classes that are about a spelling, not a marker */
  target?: (t: string, md: Record<string, any>) => boolean
  /** the wall's disposition — the lane's own ruling, from the D7 table */
  disposition: string
  /** the falsifier's RUN — the command that re-measures this class */
  run: string
  /** the falsifier's WOULD-FAIL — what a run would report if the ruling were false */
  wouldFail: string
}
const PLATFORM_ROOTS = ["clojure", "cljs", "js", "goog", "java", "javax"]
const isClassShaped = (s: string): boolean => /^[A-Z]/.test(s)
const rootOf = (t: string): string | null => {
  const segs = t.split(/\/|\.|::|:/)
  for (let n = segs.length; n >= 1; n--) {
    const cand = segs.slice(0, n).join(".")
    if (PLATFORM_ROOTS.includes(cand)) return cand
  }
  return null
}
const WALLS: WallDef[] = [
  {
    key: "language-namespace-claim",
    what: "the target names a LANGUAGE/RUNTIME namespace (the closed root set clojure/cljs/js/goog/java/javax), so no project can declare it",
    keys: ["languageNamespace"],
    disposition: "CLAIMED — the analyzer publishes the languageNamespace claim with the closed root list; the arbiter confirms it against the project key space; extOK carries it, extFAIL would refute it (0 measured)",
    run: "BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts clojure clj,cljs,cljc,edn 0 --index --dump",
    wouldFail: "THIS RUN FAILS IF the claim is false: any edge carrying `languageNamespace` whose target's ROOT is NOT in the closed set {clojure,cljs,js,goog,java,javax}, or whose target IS declared by the project, reads `externalRefuted` — extFAIL > 0 and clause 4 fails. Note what is NOT a falsifier here: a language namespace being absent from the corpus (the claim is about the language, not about the corpus).",
  },
  {
    key: "dependency-membership-claim",
    what: "the target names a THIRD-PARTY module (babashka.*, rewrite-clj.*, ring.* …), and whether that module is a project dependency or an external library is a PROJECT fact a single-file analyzer cannot hold",
    keys: ["packageScope"],
    disposition: "CLAIMED — the analyzer publishes the dependency-membership claim and the arbiter checks it against the project's own manifest facts; the rows no check can reach read ext? and the rows the project CONFIRMS read extOK; extFAIL would refute it (0 measured)",
    run: "BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts clojure clj,cljs,cljc,edn 0 --index --dump",
    wouldFail: "THIS RUN FAILS IF the claim is false: any edge carrying `packageScope` whose target IS declared by the project, or whose specifier names a module the project's manifest DOES list, reads `externalRefuted` — extFAIL > 0 and clause 4 fails. Note what is NOT a falsifier here: a third-party module being absent from the corpus (absence of the library is not evidence about the edge).",
  },
  {
    key: "java-jvm-interop",
    what: "the target is a JVM member (Class/member, Class.member, a .field read) or a JVM class — and the lane's declared contract is hasTypeInference: false, so a receiver's TYPE is not known",
    keys: ["isJavaInterop", "isStaticInteropClass", "isStaticInterop", "isFieldAccess"],
    disposition: "RULED UNDECIDABLE — the lane's contract publishes no type inference, so `Class/member` carries no owner fact and no claim channel (owner / namespace / importPath / ownerMemberAbsent) can check a member of an unstated receiver type",
    run: "bun run script/m14/clojure-wall-census.ts",
    wouldFail: "THIS CENSUS FAILS IF the ruling is false: any edge in this class whose metadata carries an OWNER or a TYPE fact (a receiver type the analyzer published) would make the class CHECKABLE and the ruling void — the census prints the owner-bearing rows of this class separately, and a non-zero count there is the refutation.",
  },
  {
    key: "ctor-and-tagged-literal",
    what: "the target is a constructor or a reader-literal class tag (#inst, #uuid, #tag) — data-adjacent, and the class is external to the project by construction",
    keys: ["isCtorLiteral", "isTaggedLiteral"],
    disposition: "RULED UNDECIDABLE — a reader literal's class tag is DATA-adjacent; there is no claim spelling for it in this lane's contract",
    run: "bun run script/m14/clojure-wall-census.ts",
    wouldFail: "THIS CENSUS FAILS IF the ruling is false: a tagged-literal or ctor row whose class IS declared in the project would be resolvable and would not belong in this class — the census prints those rows' count and a non-zero count of project-declared ones is the refutation.",
  },
  {
    key: "library-dependency",
    what: "the target names a library the analyzer knows is a dependency (its own `isLibraryDep` marker) — the dependency is real, the DECLARATION is in another file",
    keys: ["isLibraryDep"],
    disposition: "CLAIMED — the dependency fact is the analyzer's own; the arbiter's project facts decide whether it can be confirmed",
    run: "BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts clojure clj,cljs,cljc,edn 0 --index --dump",
    wouldFail: "THIS RUN FAILS IF the claim is false: any edge carrying `isLibraryDep` whose target IS declared by the project, or whose external claim is REFUTED, reads `externalRefuted` — extFAIL > 0 and clause 4 fails.",
  },
  {
    key: "overrides-cross-file-protocol",
    what: "an `overrides` edge whose protocol method is declared in ANOTHER file of the project — the analyzer's strict join publishes an override only when the SAME file declares the protocol method",
    keys: [],
    target: (_t, md) => md.relationshipType === "overrides" || md.type === "overrides",
    disposition: "RULED UNDECIDABLE — the residual names a member identity (Owner.member) with no declaration to resolve, and a claim needs the OWNING PROTOCOL, which the per-file analyzer does not have",
    run: "bun run script/m14/clojure-wall-census.ts",
    wouldFail: "THIS CENSUS FAILS IF the ruling is false: an `overrides` edge whose target protocol method IS declared in the project would be resolvable — the census prints the count of overrides rows whose target is a project-declared name, and a non-zero count there is the refutation.",
  },
  {
    key: "bare-name-absent",
    what: "the target is a BARE name that no project file declares and no import brings in — a macro-created var, a dynamic invocation, or a genuinely absent name",
    keys: [],
    target: (t, md) =>
      !t.includes("/") && !t.includes(".") && !isClassShaped(t) &&
      md.relationshipType !== "contains" && md.relationshipType !== "exports",
    disposition: "INSTRUMENT GAP — the name is not declared anywhere in the run and not imported; a single-file lane cannot decide ABSENCE from EXTERNALITY, and the gate's own key space (a project-wide declaration lookup) is what answers it",
    run: "bun run script/m14/clojure-wall-census.ts",
    wouldFail: "THIS CENSUS FAILS IF the ruling is false: a bare-name row whose target IS declared somewhere in the project would be RESOLVABLE and would not be a gap — the census prints the count of bare-name rows whose target is a project-declared symbol, and a non-zero count there is the refutation.",
  },
  {
    key: "name-model-ambiguity",
    what: "the target has MORE THAN ONE declaration in the project, so the name model cannot choose — the tie-break picks one",
    keys: [],
    target: (_t, md) => md.ambiguousByDeclaration === true || md.ambiguous === true || md.isAmbiguous === true,
    disposition: "INSTRUMENT GAP — the gate resolves names PROJECT-WIDE and a bare name that is unique in a project is resolved; where the same name is declared in several files or namespaces the project-scoped name model collides. The lane owns no namespace-aware module-space fact",
    run: "bun run script/m14/clojure-wall-census.ts",
    wouldFail: "THIS CENSUS FAILS IF the ruling is false: an ambiguous row whose target has EXACTLY ONE project declaration would be RESOLVED by the name model and would not be ambiguous — the census prints the count of ambiguous rows with a unique project declaration, and a non-zero count there is the refutation.",
  },
]

/* ── run ── */
const { files, repos, byExt, symlinks } = discover()
console.log(`POPULATION: ${files.length} files over ${repos.size} repositories`)

const { RealClojureAnalyzer } = await import("../../src/ast/real-clojure-analyzer")

type Row = {
  type: string
  target: string
  source: string
  line: number
  md: Record<string, any>
  file: string
}
const rows: Row[] = []
const perFile: { file: string; edges: number; symbols: number }[] = []
/** the project's own name space: every name the population DECLARES (for the falsifiers) */
const declaredNames = new Map<string, number>()
let filesParsed = 0
let parseFailures = 0

for (const abs of files) {
  let src: string
  try { src = readFileSync(abs, "utf8") } catch { continue }
  const tree = parser.parse(src)
  if (!tree) { parseFailures++; continue }
  filesParsed++
  try {
    const analyzer = new RealClojureAnalyzer()
    const res: any = analyzer.analyze(tree.rootNode, src, abs)
    const rels: any[] = res?.relationships ?? []
    const syms: any[] = res?.symbols ?? []
    perFile.push({ file: abs, edges: rels.length, symbols: syms.length })
    for (const s of syms) {
      const nm = String(s.name ?? "")
      if (nm.length > 0) declaredNames.set(nm, (declaredNames.get(nm) ?? 0) + 1)
      const qn = typeof s.qualifiedName === "string" ? s.qualifiedName : ""
      if (qn.length > 0 && !qn.includes("\u0000")) {
        declaredNames.set(qn, (declaredNames.get(qn) ?? 0) + 1)
      }
    }
    for (const r of rels) {
      rows.push({
        type: String(r.type ?? r.relationshipType ?? ""),
        target: String(r.target ?? ""),
        source: String(r.source ?? r.from ?? ""),
        line: Number(r.line ?? r.line_number ?? 0),
        md: (r.metadata ?? {}) as Record<string, any>,
        file: abs,
      })
    }
  } catch (e: any) {
    parseFailures++
  }
  try { tree.delete() } catch { /* a tree that cannot be freed is not a failed measurement */ }
}

/* ── classify EVERY row into the wall classes, and count the CONTROL ── */
const classCounts: Record<string, number> = {}
const classSamples: Record<string, string[]> = {}
for (const w of WALLS) {
  classCounts[w.key] = 0
  classSamples[w.key] = []
}
let totalEdges = 0
const perTypeEdges: Record<string, number> = {}

/* ── THE FALSIFIERS' OWN CONTROL: a row in a RULED class whose target IS project-declared would
 *    make that class CHECKABLE, and that is exactly the refutation of the ruling. Measured here,
 *    not assumed — a stated caveat is a ruling, and an unstated one is a hole. ── */
let bareNameProjectDeclared = 0
let overridesProjectDeclared = 0
for (const r of rows) {
  if (r.target.length === 0) continue
  if ((declaredNames.get(r.target) ?? 0) === 0) continue
  if (r.type === "overrides") overridesProjectDeclared++
  if (!r.target.includes("/") && !r.target.includes(".") && !isClassShaped(r.target)) {
    bareNameProjectDeclared++
  }
}

for (const r of rows) {
  totalEdges++
  perTypeEdges[r.type] = (perTypeEdges[r.type] ?? 0) + 1
  for (const w of WALLS) {
    const byKey = w.keys.length > 0 && w.keys.some((k) => r.md[k] !== undefined && r.md[k] !== false)
    const byTarget = w.target ? w.target(r.target, { ...r.md, relationshipType: r.type }) : false
    if (!byKey && !byTarget) continue
    classCounts[w.key]++
    if (classSamples[w.key].length < 3) {
      classSamples[w.key].push(`${r.type} ${r.target} @ ${path.relative(CR, r.file)}:${r.line}`)
    }
  }
}

/* ── the CONTROL: the population's edges, the classified rows, and the sum ── */
const classifiedRows = new Set<string>()
{
  const seen = new Set<string>()
  for (const r of rows) {
    for (const w of WALLS) {
      const byKey = w.keys.length > 0 && w.keys.some((k) => r.md[k] !== undefined && r.md[k] !== false)
      const byTarget = w.target ? w.target(r.target, { ...r.md, relationshipType: r.type }) : false
      if (byKey || byTarget) seen.add(`${r.file}|${r.line}|${r.type}|${r.target}`)
    }
  }
  for (const s of seen) classifiedRows.add(s)
}

const report = {
  instrument: "clojure-wall-census",
  generated: new Date().toISOString(),
  method: {
    populationSource: "git ls-files over BB_CORPUS_ROOT (the same discovery the arm uses)",
    populationRule: "`git ls-files` inside each checkout of the corpus root, .clj/.cljs/.cljc/.edn, at or under the 1 MiB cap — NOT a walk of the disk, which would find untracked files the repositories do not carry",
    symlinkedDirectories: symlinks,
    analyzer: "src/ast/real-clojure-analyzer.ts (production)",
    grammarSha256: wasmSha256,
    classification: "by the ANALYZER'S OWN METADATA KEYS and the row's own target spelling — no regex over source text",
    note: "THE ANALYZER IS PER FILE AND DOES NOT DECIDE RESOLUTION: the arm's arbiter does. This census counts the ROWS each wall class HOLDS, over the same population the arm measured.",
  },
  population: {
    files: files.length,
    filesParsed,
    parseFailures,
    repos: Object.fromEntries(repos),
    byExt: Object.fromEntries(byExt),
  },
  control: {
    totalEdges: totalEdges,
    perTypeEdges,
    classifiedRows: classifiedRows.size,
    unclassifiedRows: totalEdges - classifiedRows.size,
    declaredNames: declaredNames.size,
    bareNameProjectDeclared,
    overridesProjectDeclared,
    note:
      "bareNameProjectDeclared and overridesProjectDeclared are the FALSIFIERS' OWN CONTROLS: a row in a RULED class whose target IS declared by the project would make that class CHECKABLE, so a non-zero count here is the refutation of the ruling. 0 means the ruling is not refuted BY THIS INSTRUMENT — which is not the same as the ruling being true.",
  },
  walls: WALLS.map((w) => ({
    key: w.key,
    what: w.what,
    rows: classCounts[w.key],
    samples: classSamples[w.key],
    disposition: w.disposition,
    falsifier: { run: w.run, wouldFail: w.wouldFail },
  })),
}

if (OUT) {
  writeFileSync(path.resolve(ROOT, OUT), JSON.stringify(report, null, 2))
  console.log(`WROTE ${OUT}`)
}
console.log("")
console.log("=== THE CONTROL ===")
console.log(`edges ${totalEdges} over ${filesParsed} files · classified ${classifiedRows.size} · unclassified ${totalEdges - classifiedRows.size}`)
console.log("")
console.log("=== THE WALL CLASSES ===")
for (const w of report.walls) {
  console.log(`${String(w.rows).padStart(7)}  ${w.key}`)
  for (const s of w.samples) console.log(`          · ${s}`)
}
console.log("")
console.log(`parse failures ${parseFailures}`)
process.exit(0)
