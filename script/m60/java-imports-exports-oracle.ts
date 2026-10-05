/**
 * JAVA `imports` / `exports` ORACLE — the second opinion the differential never
 * had.
 *
 * ## Why this exists
 *
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 (DERIVATION) reports, measured
 * at the commit this ran against:
 *
 *     DERIVATION|java|emits `exports` but the differential audits
 *       ["calls","contains","extends","implements","instantiates","overrides",
 *        "references","uses"] — the type is stored and compared against nothing
 *
 * `imports` joins it the moment the analyzer starts emitting the label. Both are
 * in the family's ten, both are in `graph-engine.ts`'s `DEFAULT_REL_TYPES`, and
 * an unverified edge there ships a bug invisibly — the same structural gap the
 * ontology gate's header describes for bash's `overrides`.
 *
 * ## WHAT INDEPENDENCE THIS ORACLE HAS, AND WHAT IT DOES NOT
 *
 * It has a separate walker and a separate implementation: the target of an import
 * is rebuilt here by DESCENDING the `scoped_identifier` spine and collecting the
 * `identifier` leaves, where the analyzer reads one `scoped_identifier` child and
 * takes its text. Two implementations of one JLS rule disagree when either is
 * wrong.
 *
 * It does NOT have an independent grammar. Both sides load the same
 * `tree-sitter-java` wasm, so a bug IN the grammar — a node type that fails to
 * match, a field that is never populated — is invisible to this oracle exactly as
 * it is to the differential. That limit is recorded in the artifact rather than
 * papered over, and it is the same limit the honesty contract's L3 definition
 * states.
 *
 * ## WHAT IS DERIVED, FROM WHICH JLS RULE
 *
 *   imports  JLS 7.5.1 single-type / 7.5.2 type-on-demand / 7.5.3 static
 *            → one dependency per `import_declaration`
 *            JLS 7.7.1 `requires M` → one module dependency per
 *            `requires_module_directive`
 *   exports  JLS 7.6 a type in a NAMED package is exported iff it is public
 *            → one publication per public top-level type
 *            JLS 7.7.2 `exports P` → one publication per exported package
 *
 * `opens_module_directive` is deliberately NOT derived for either label: it grants
 * reflective access at run time and publishes nothing (JLS 7.7.3), so deriving it
 * would be an edge the language does not express.
 *
 * ## SHARDING
 *
 * `ASTEngine.parseFile` arms a 120 s wall-time self-destruct timer around the
 * synchronous `parser.parse()` and exits the process when it fires, so a shard is
 * one process for the same reason the census shards (see that file's header).
 *
 *   npx tsx script/m60/java-imports-exports-oracle.ts --shard=i/n out.json
 *   npx tsx script/m60/java-imports-exports-oracle.ts --merge out.json
 *   npx tsx script/m60/java-imports-exports-oracle.ts out.json [maxFiles]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (process.env.BB_JAVA_REPOS ?? "java-lib,java-sample").split(",").map((s) => s.trim()).filter(Boolean)
const argv = process.argv.slice(2)
const isMerge = argv.includes("--merge")
const OUT = argv.find((a) => !a.startsWith("--") && !/^\d+\/\d+$/.test(a)) ?? ""
const MAX = Number(argv.filter((a) => !a.startsWith("--") && !/^\d+\/\d+$/.test(a))[1] ?? "0") || Infinity
const SHARD_DIR = path.join("validation", "m60", "results", "java-oracle-shards")
const CONCURRENCY = Number(process.env.BB_JAVA_ORACLE_WORKERS ?? "3")

const files: Array<{ repo: string; dir: string; rel: string; abs: string }> = []
const revisions: Record<string, string> = {}
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.java"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
    revisions[repo] = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    files.push({ repo, dir, rel, abs })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : a.repo + a.rel > b.repo + b.rel ? 1 : 0))
const capped = files.slice(0, MAX === Infinity ? files.length : MAX)

const shardRaw = argv.find((a) => a.startsWith("--shard="))?.slice("--shard=".length)
  ?? (argv.find((a) => /^\d+\/\d+$/.test(a)) ?? "")
let shard: { i: number; n: number } | null = null
if (shardRaw) {
  const [i, n] = shardRaw.split("/").map(Number)
  if (!Number.isInteger(i) || !Number.isInteger(n) || n <= 0 || i < 0 || i >= n) {
    console.error(`--shard must be i/n with 0 <= i < n, got ${shardRaw}`); process.exit(2)
  }
  shard = { i, n }
}
const corpus = shard ? capped.filter((_, k) => k % shard.n === shard.i) : capped

/* ------------------------------------------------------------------ merge */
if (isMerge) {
  if (!OUT) { console.error("--merge needs the artifact path to write"); process.exit(2) }
  const names = readdirSync(SHARD_DIR).filter((n) => n.endsWith(".json")).sort()
  const oracle: OracleRow[] = []
  const observed: ObservedRow[] = []
  const revs: Record<string, string> = {}
  let fileCount = 0, parseFail = 0
  for (const n of names) {
    const d = JSON.parse(readFileSync(path.join(SHARD_DIR, n), "utf8"))
    oracle.push(...(d.oracle ?? []))
    observed.push(...(d.observed ?? []))
    Object.assign(revs, d.corpus?.revisions ?? {})
    fileCount += d.corpus?.files ?? 0
    parseFail += d.corpus?.parseFail ?? 0
  }
  adjudicate(oracle, observed, { repos: REPOS, revisions: revs, files: fileCount, parseFail }, names.length)
  process.exit(0)
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "node_modules", "tree-sitter-java", "tree-sitter-java.wasm"))))

/* ------------------------------------------------------------------ oracle */
const TYPE_DECLS = new Set(["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"])

/**
 * Rebuild a dotted name by DESCENDING the identifier spine and concatenating the
 * leaves. `scoped_identifier(a.b.C)` yields [a, b, C]; a bare `identifier` yields
 * itself. This is deliberately not `node.text` and not a single child lookup: the
 * analyzer takes one `scoped_identifier` child and reads its text, so a grammar
 * that stopped nesting identifiers would break one path and not the other.
 */
function dottedSpine(n: any): string {
  if (!n) return ""
  if (n.type === "identifier") return n.text
  if (n.type === "scoped_identifier") {
    const parts: string[] = []
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && (c.type === "identifier" || c.type === "scoped_identifier")) parts.push(dottedSpine(c))
    }
    return parts.filter(Boolean).join(".")
  }
  return n.text ?? ""
}

/** The `modifiers` child of a declaration, as text. Empty when there are none. */
function modifiersText(n: any): string {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === "modifiers") return c.text
  }
  return ""
}

function isModuleDirective(n: any, type: string): boolean {
  return n.type === type
}

type OracleRow = { file: string; type: "imports" | "exports"; source: string; target: string; reason: string; line: number }
type ObservedRow = { file: string; type: "imports" | "exports"; source: string; target: string; line?: number; metaRelType: string; confidence: number }

const oracle: OracleRow[] = []
const observed: ObservedRow[] = []
let parseFail = 0
let cursor = 0

async function worker() {
  for (;;) {
    const i = cursor++
    if (i >= corpus.length) return
    const f = corpus[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFail++; continue }
    for (const x of r.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "")
      if (t !== "imports" && t !== "exports") continue
      observed.push({
        file: label, type: t, source: String(x.source ?? ""), target: String(x.target ?? ""),
        line: x.line_number, metaRelType: String((x.metadata ?? {}).relationshipType ?? "(none)"),
        confidence: typeof x.confidence === "number" ? x.confidence : 1,
      })
    }

    let tree: any
    try { tree = parser.parse(readFileSync(f.abs, "utf8")) } catch { continue }
    if (!tree) continue
    const root = tree.rootNode

    const packageName = (() => {
      for (let i = 0; i < root.namedChildCount; i++) {
        const c = root.namedChild(i)
        if (c && c.type === "package_declaration") {
          for (let j = 0; j < c.namedChildCount; j++) {
            const cc = c.namedChild(j)
            if (cc && (cc.type === "scoped_identifier" || cc.type === "identifier")) return dottedSpine(cc)
          }
        }
      }
      return ""
    })()
    const moduleName = (() => {
      for (let i = 0; i < root.namedChildCount; i++) {
        const c = root.namedChild(i)
        if (c && c.type === "module_declaration") {
          const nm = c.childForFieldName?.("name")
          if (nm) return dottedSpine(nm)
        }
      }
      return ""
    })()

    // --- JLS 7.5: every import declaration is a dependency ---
    for (let i = 0; i < root.namedChildCount; i++) {
      const c = root.namedChild(i)
      if (!c || c.type !== "import_declaration") continue
      let target = ""
      for (let j = 0; j < c.namedChildCount; j++) {
        const cc = c.namedChild(j)
        if (cc && (cc.type === "scoped_identifier" || cc.type === "identifier")) { target = dottedSpine(cc); break }
      }
      if (!target) continue
      // The wildcard is a SEPARATE child (`asterisk`), so "is this on-demand" is
      // asked of the tree and never of the declaration's text. Measured against
      // the pinned grammar: `import java.util.Map.*;` has children
      // [import, scoped_identifier, ".", asterisk, ";"], so the asterisk is
      // unambiguous.
      let onDemand = false
      for (let j = 0; j < c.childCount; j++) { const cc = c.child(j); if (cc && cc.type === "asterisk") onDemand = true }
      // `static` is its own ANONYMOUS child (`import_declaration` has no fields
      // and its named children are only asterisk/identifier/scoped_identifier), so
      // the modifier is asked of the tree too. The analyzer reads it from the
      // declaration's text instead; that is the kind of difference this oracle
      // exists to notice, and it is why the shape label is compared here and not
      // only the edge set.
      let isStatic = false
      for (let j = 0; j < c.childCount; j++) { const cc = c.child(j); if (cc && cc.type === "static") isStatic = true }
      oracle.push({
        file: label, type: "imports", source: "", target,
        reason: isStatic ? (onDemand ? "static_on_demand" : "static_member") : (onDemand ? "on_demand_type" : "single_type"),
        line: c.startPosition.row + 1,
      })
    }

    // --- JLS 7.7.1 / 7.7.2: the module directives ---
    if (moduleName) {
      const stack: any[] = [root]
      while (stack.length) {
        const n = stack.pop()
        if (isModuleDirective(n, "requires_module_directive")) {
          const m = n.childForFieldName?.("module")
          if (m) oracle.push({ file: label, type: "imports", source: moduleName, target: dottedSpine(m), reason: "module_requires", line: m.startPosition.row + 1 })
        } else if (isModuleDirective(n, "exports_module_directive")) {
          const p = n.childForFieldName?.("package")
          if (p) oracle.push({ file: label, type: "exports", source: moduleName, target: dottedSpine(p), reason: "module_exports", line: p.startPosition.row + 1 })
        }
        for (let j = 0; j < n.namedChildCount; j++) { const cc = n.namedChild(j); if (cc) stack.push(cc) }
      }
    }

    // --- JLS 7.6: a public top-level type in a NAMED package is exported ---
    for (let i = 0; i < root.namedChildCount; i++) {
      const c = root.namedChild(i)
      if (!c || !TYPE_DECLS.has(c.type)) continue
      const nm = c.childForFieldName?.("name")
      if (!nm) continue
      if (!packageName) continue
      if (modifiersText(c).indexOf("public") === -1) continue
      oracle.push({ file: label, type: "exports", source: packageName, target: nm.text, reason: "exported_type", line: nm.startPosition.row + 1 })
    }
    tree.delete?.()
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

/* ------------------------------------------------------- set adjudication
 *
 * An `imports` edge's SOURCE is the file's primary type, which the oracle cannot
 * know: the type declaration follows the imports in source order. An oracle row
 * with an unknown source is therefore matched on `file + type + target`. An
 * `exports` row has a derivable source (the package, or the module) and is
 * matched on it too — a package disagreement is a disagreement, not a wildcard.
 */
// Function declarations, not arrow consts: the --merge branch above runs before
// this point in the file and hoisting is what lets it call adjudicate() at all.
function obsKey(r: ObservedRow): string { return `${r.file}|${r.type}|${r.target}|${r.source}` }
function oraKey(r: OracleRow): string { return `${r.file}|${r.type}|${r.target}|${r.source}` }
function obsFileKey(r: ObservedRow): string { return `${r.file}|${r.type}|${r.target}` }
function oraFileKey(r: OracleRow): string { return `${r.file}|${r.type}|${r.target}` }

function adjudicate(
  oracle: OracleRow[], observed: ObservedRow[],
  corpus: Record<string, unknown>, shardsMerged?: number,
) {
  const byType: Record<string, any> = {}
  for (const type of ["imports", "exports"] as const) {
    const o = oracle.filter((r) => r.type === type)
    const v = observed.filter((r) => r.type === type)
    const obsSet = new Set(v.map(obsKey))
    const oraSetLoose = new Set(o.map(oraFileKey))
    const obsSetLoose = new Set(v.map(obsFileKey))
    const matched = o.filter((r) => (r.source === "" ? obsSetLoose.has(oraFileKey(r)) : obsSet.has(oraKey(r))))
    const matchedSet = new Set(matched.map((r) => oraFileKey(r)))
    const missing = o.filter((r) => !matchedSet.has(oraFileKey(r)))
    const explained = v.filter((r) => obsSetLoose.has(oraFileKey(r)))
    const unexplained = v.filter((r) => !oraSetLoose.has(obsFileKey(r)))
    // Q4 — LABELLED. An edge can carry the right endpoint and the wrong
    // `metadata.relationshipType`, and the edge-set comparison above would score
    // that as agreement. Every agreed pair is therefore compared on its shape
    // label too. `module_requires` / `module_exports` are this oracle's own names
    // and are compared only where both sides wrote one.
    const labelDisagreements: string[] = []
    let labelCompared = 0
    for (const r of matched) {
      const obs = v.filter((o) => obsFileKey(o) === oraFileKey(r))
      if (obs.length === 0) continue
      labelCompared++
      for (const o of obs) {
        if (o.metaRelType === "(none)") continue
        if (o.metaRelType !== r.reason) {
          labelDisagreements.push(`${r.file}:${r.line} ${type} ${r.target} oracle=${r.reason} analyzer=${o.metaRelType}`)
        }
      }
    }
    byType[type] = {
      labelCompared,
      labelDisagreements: labelDisagreements.length,
      labelDisagreementExamples: labelDisagreements.slice(0, 8),
      oracleEdges: o.length,
      observedEdges: v.length,
      oracleFiles: new Set(o.map((r) => r.file)).size,
      observedFiles: new Set(v.map((r) => r.file)).size,
      agreed: matched.length,
      missing: missing.length,
      unexplained: unexplained.length,
      precision: v.length ? +((100 * explained.length) / v.length).toFixed(2) : null,
      recall: o.length ? +((100 * matched.length) / o.length).toFixed(2) : null,
      oracleShapeCounts: o.reduce<Record<string, number>>((a, r) => { a[r.reason] = (a[r.reason] ?? 0) + 1; return a }, {}),
      observedMetadataRelTypes: v.reduce<Record<string, number>>((a, r) => { a[r.metaRelType] = (a[r.metaRelType] ?? 0) + 1; return a }, {}),
      observedConfidence: v.reduce<Record<string, number>>((a, r) => { const k = String(r.confidence); a[k] = (a[k] ?? 0) + 1; return a }, {}),
      missingExamples: missing.slice(0, 8).map((r) => `${r.file}:${r.line} ${r.type} ${r.source || "*"} -> ${r.target} (${r.reason})`),
      unexplainedExamples: unexplained.slice(0, 8).map((r) => `${r.file}:${r.line ?? "?"} ${r.type} ${r.source} -> ${r.target}`),
      uniqueOracleTargets: oraSetLoose.size,
      uniqueObservedTargets: obsSetLoose.size,
    }
  }
  const out = {
    tool: "script/m60/java-imports-exports-oracle.ts",
    corpus: { ...corpus, shardsMerged: shardsMerged ?? null },
    independence: {
      separateWalker: true,
      sameGrammar: true,
      sharedGrammarBugInvisible: "the oracle and the analyzer both load node_modules/tree-sitter-java/tree-sitter-java.wasm; a grammar defect is invisible to this comparison, exactly as it is to script/m14/differential.ts",
      divergentImplementation: "the import target is rebuilt here by descending the scoped_identifier spine and concatenating identifier leaves; the analyzer reads one scoped_identifier child and takes its text",
    },
    byType,
  }
  console.log(JSON.stringify({ corpus: out.corpus, independence: out.independence, byType }, null, 2))
  if (OUT) { writeFileSync(OUT, JSON.stringify({ ...out, oracle, observed }, null, 0)); console.log(`\nwrote ${OUT}`) }
  return out
}

if (shard) {
  if (!OUT) { console.error("a shard needs its artifact path: --shard=i/n <out.json>"); process.exit(2) }
  writeFileSync(OUT, JSON.stringify({
    tool: "script/m60/java-imports-exports-oracle.ts",
    shard: `${shard.i}/${shard.n}`,
    corpus: { repos: REPOS, revisions, files: corpus.length, parseFail },
    oracle, observed,
  }, null, 0))
  console.log(`java imports/exports oracle shard ${shard.i}/${shard.n} — ${corpus.length} files, oracle ${oracle.length} rows, observed ${observed.length} rows, parse failures ${parseFail}`)
  process.exit(0)
}

adjudicate(oracle, observed, { repos: REPOS, revisions, files: corpus.length, parseFail })
