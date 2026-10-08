/**
 * JAVA LANE ORACLE — the independent second opinion for the two types the shared
 * differential never audits.
 *
 * ## WHY THIS FILE EXISTS
 *
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 (DERIVATION) reports, measured
 * against this lane's bytes:
 *
 *     DERIVATION|java|emits `exports` but the differential audits
 *       ["calls","contains","extends","implements","instantiates","overrides",
 *        "references","uses"]
 *
 * — eight labels, and `imports` was absent from BOTH sets before this lane
 * emitted it. A DERIVATION finding is the honesty contract's "stored and compared
 * against nothing": the edge ships, a bug in it ships with it, and no instrument
 * is watching. That is the finding the workstream calls as valuable as adding
 * anything, and it is now two findings on one lane.
 *
 * This is the answer for the two labels the shared file cannot reach.
 *
 * ## WHAT INDEPENDENCE THIS ORACLE HAS, AND WHAT IT DOES NOT
 *
 * It has a separate walker and a separate implementation. For an import target
 * the oracle DESCENDS the `scoped_identifier` spine and concatenates the
 * `identifier` leaves; the analyzer asks `childText(node, "scoped_identifier")`
 * and takes its text. For visibility the oracle reads the `modifiers` child as a
 * set of child node types and tests for the `public` token; the analyzer runs
 * `getJavaVisibility` over a modifier string. Two implementations of one JLS rule
 * disagree when either is wrong.
 *
 * It does NOT have an independent grammar. Both sides load the same
 * `tree-sitter-java` wasm, so a bug IN the grammar — a production that fails to
 * match, a field that is never populated — is invisible here exactly as it is to
 * the differential. That limit is the harness's declared limitation (workstream
 * Part 1 q3) and it is stated in the artifact rather than papered over.
 *
 * ## WHAT IS DERIVED, FROM WHICH JLS RULE
 *
 *   imports  JLS 7.5.1 single-type / 7.5.2 type-on-demand / 7.5.3 static
 *              -> one dependency per `import_declaration`
 *            JLS 7.7.1 `requires M`
 *              -> one module dependency per `requires_module_directive`
 *   exports  JLS 7.6   a top-level type is importable iff it is `public`
 *              -> one publication per public top-level type
 *
 * The JPMS `exports P` directive is deliberately NOT derived for `exports` and
 * NOT derived for `imports`: it publishes this module's API outward (JLS 7.7.2),
 * which is not a dependency, and the analyzer rides it as `references` — so
 * deriving it here would manufacture a disagreement rather than find a bug.
 *
 * ## NORMALISATION, AND WHY EACH STEP IS NEEDED
 *
 * The analyzer post-processes two things after the walk, and an oracle that
 * ignored them would report disagreement where there is none — which is how an
 * oracle gets switched off.
 *
 *   N1 importSource  the `references` half of an import is re-sourced from the
 *                    package to the file's PRIMARY TYPE (the first top-level
 *                    type), because an import precedes the type declaration in
 *                    the file. The `imports` half is NOT re-sourced, by design:
 *                    its consumer keys on the file.
 *   N2 visibility    a package-private top-level type is published at 0.6 with a
 *                    reasonCode rather than 1.0. The oracle derives the same
 *                    tier from `modifiers`, so a flattened tier disagrees.
 *
 * ## NO REGEX
 *
 * Tree walk over `node.type` and named children; every classification is a node
 * comparison or a character walk; file population by `readdirSync` + `endsWith`.
 *
 * ## USAGE
 *   bun script/m14/lanes/java-imports-exports-oracle.ts
 *   LANE_NFILES=200 bun script/m14/lanes/java-imports-exports-oracle.ts
 *   LANE_CONC=6 bun script/m14/lanes/java-imports-exports-oracle.ts
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../src/ast/engine"
import { RealJavaAnalyzer } from "../../../src/ast/real-java-analyzer"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_DIR = process.env.BB_REPO ?? "java-lib"
const WANT = Number(process.env.LANE_NFILES ?? 0)
const CONC = Number(process.env.LANE_CONC ?? 8)

const root = join(CORPUS_ROOT, REPO_DIR)
const all: string[] = []
;(function walk(d: string): void {
  let ents
  try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "target") continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".java")) all.push(p)
  }
})(root)
all.sort()
const files = WANT > 0 ? all.slice(0, WANT) : all

const TOP_LEVEL = new Set([
  "class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration",
])

/** Rebuild a dotted name by DESCENDING the identifier spine. Deliberately not
 *  `node.text` and not a single child lookup: the analyzer reads one
 *  `scoped_identifier` child and takes its text, so a grammar that stopped
 *  nesting identifiers would break one path and not the other. */
function dottedSpine(n: any): string {
  if (!n) return ""
  if (n.type === "identifier") return String(n.text)
  if (n.type === "scoped_identifier") {
    const parts: string[] = []
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && (c.type === "identifier" || c.type === "scoped_identifier")) parts.push(dottedSpine(c))
    }
    return parts.filter(Boolean).join(".")
  }
  return ""
}

/** The declared visibility, read from the `modifiers` child's node types rather
 *  than from a modifier string. Returns "" when there is no modifier at all,
 *  which is the package-private case and is NOT the same as "private". */
function declaredVisibility(decl: any): string {
  for (let i = 0; i < decl.namedChildCount; i++) {
    const c = decl.namedChild(i)
    if (!c || c.type !== "modifiers") continue
    for (let j = 0; j < c.childCount; j++) {
      const m = c.child(j)
      if (!m) continue
      if (m.type === "public" || m.type === "private" || m.type === "protected") return m.type
    }
  }
  return ""
}

function moduleNameOf(rootNode: any): string {
  for (let i = 0; i < rootNode.namedChildCount; i++) {
    const c = rootNode.namedChild(i)
    if (!c || c.type !== "module_declaration") continue
    const nm = c.childForFieldName?.("name")
    if (nm) return dottedSpine(nm) || String(nm.text ?? "")
  }
  return ""
}

type Key = string
type Row = { file: string; type: "imports" | "exports"; key: Key; line: number; conf: number; meta: string }

const oracle: Row[] = []
const observed: Row[] = []
let parseFail = 0
let cursor = 0

async function worker(): Promise<void> {
  const parser = await getParser("java")
  for (;;) {
    const i = cursor++
    if (i >= files.length) return
    const f = files[i]
    const L = relative(root, f)
    let content: string
    let rootNode: any
    try {
      content = readFileSync(f, "utf8")
      const pr = await parser.parse(content)
      if (!pr) throw new Error("parser.parse returned no tree (null result)")
      rootNode = pr.rootNode
    } catch { parseFail++; continue }

    // ---- OBSERVED: the production analyzer
    let res: any
    try { res = new RealJavaAnalyzer().analyze(rootNode, content, f) } catch { parseFail++; continue }
    const primaryType = (() => {
      for (const s of res.symbols ?? []) {
        if (s.ownerName) continue
        if (TOP_LEVEL.has(String(s.metadata?.nodeType ?? ""))) return String(s.name)
      }
      for (const s of res.symbols ?? []) if (!s.ownerName) return String(s.name)
      return ""
    })()
    const pkg = String(res.metadata?.currentPackage ?? "")
    for (const r of res.relationships ?? []) {
      const t = String(r.type ?? r.relationshipType ?? "")
      if (t !== "imports" && t !== "exports") continue
      const md = r.metadata ?? {}
      // N1 IS DELIBERATELY NOT APPLIED HERE, and applying it was this oracle's
      // first bug: it reported 0 TP / 2,167 FP / 2,167 FN on `imports` while
      // both sides agreed on every row.
      //
      // The analyzer's post-pass (real-java-analyzer.ts:1919-1925) re-sources
      // import-derived rows from the package to the file's PRIMARY TYPE — and it
      // matches on `References` ONLY, not on `imports`. The asymmetry is the
      // design, not an oversight: the `references` consumer joins against symbols
      // and needs a symbol name, while the `imports` consumer keys on the FILE
      // (bb_graph's dependencies SQL compares source_external to the file path),
      // so re-sourcing it to a symbol would defeat that query.
      //
      // So the observed side must be taken AS STORED. An oracle that "normalises"
      // a difference it has not first established is a defect that reports a
      // disagreement that does not exist — the fastest way to make an oracle get
      // switched off.
      const src = String(r.source ?? "")
      observed.push({
        file: L, type: t, line: Number(r.line_number ?? 0), conf: typeof r.confidence === "number" ? r.confidence : 1,
        key: `${src}|${r.target}`,
        meta: String(md.relationshipType ?? "") + "|" + String(md.reasonCode ?? "") + "|" + String(md.isWildcard ?? "") + "|" + String(md.isStatic ?? ""),
      })
    }

    // ---- ORACLE: an independent walk of the same tree
    const modName = moduleNameOf(rootNode)
    ;(function visit(n: any, depth: number): void {
      if (n.type === "import_declaration") {
        let target = ""
        let isWildcard = false
        let isStatic = false
        for (let i = 0; i < n.childCount; i++) {
          const kid = n.child(i)
          if (!kid) continue
          if (kid.type === "asterisk") isWildcard = true
          else if (kid.type === "static") isStatic = true
        }
        for (let j = 0; j < n.namedChildCount; j++) {
          const cc = n.namedChild(j)
          if (cc && (cc.type === "scoped_identifier" || cc.type === "identifier")) { target = dottedSpine(cc); break }
        }
        if (target) {
          oracle.push({
            file: L, type: "imports", line: n.startPosition.row + 1, conf: 1,
            key: `${pkg}|${target}`,
            meta: (isStatic ? "static_member_import" : isWildcard ? "type_on_demand_import" : "single_type_import") +
              "|" + "" + "|" + isWildcard + "|" + isStatic,
          })
        }
      }
      // JLS 7.7.1 — a `requires` directive is a compile-time module dependency.
      if (n.type === "requires_module_directive" && modName) {
        const m = n.childForFieldName?.("module")
        const t = dottedSpine(m) || String(m?.text ?? "")
        if (t) oracle.push({ file: L, type: "imports", line: n.startPosition.row + 1, conf: 1, key: `${modName}|${t}`, meta: "module_requires_dependency|||" })
      }
      // JLS 7.6 — a top-level type is importable iff it is public.
      if (TOP_LEVEL.has(n.type) && depth === 1) {
        let nameNode: any = null
        for (let j = 0; j < n.namedChildCount; j++) {
          const cc = n.namedChild(j)
          if (cc && cc.type === "identifier") { nameNode = cc; break }
        }
        const name = nameNode ? String(nameNode.text) : ""
        if (name) {
          const vis = declaredVisibility(n)
          oracle.push({
            // N3 line anchor: the DECLARATION's start row, not the name's. The
            // lane's convention is node-start (M11; docs/analyzers/
            // real-java-analyzer.md's range row records it, and M59/#825 pins the
            // exports edge to "the exported DECLARATION's own line"). Anchoring on
            // the name instead is off by the annotation/modifier lines, and was
            // this oracle's second bug: it reported 197 TP with line agreement
            // 0/197, which is a disagreement about the ANCHOR rather than about
            // the edge — the worst kind, because it looks like a location defect.
            file: L, type: "exports", line: n.startPosition.row + 1,
            conf: vis === "public" ? 1 : 0.6,
            key: `${pkg}|${name}`,
            meta: "java_exportable_unit|" + (vis === "public" ? "" : "package_private_top_level_type") + "||",
          })
        }
      }
      for (let i = 0; i < n.childCount; i++) visit(n.child(i), depth + 1)
    })(rootNode, 0)
  }
}
const t0 = Date.now()
await Promise.all(Array.from({ length: CONC }, () => worker()))
const ms = Date.now() - t0

// ------------------------------------------------------------------ adjudicate
function adjudicate(type: "imports" | "exports") {
  // Keyed by `file|key`, not by the row: the row is the VALUE. The declaration
  // said `Map<Row, Row>` while every `set` call passed a string, so the five reads
  // below (`.replace` on the key, `get`/`has` with a string) described a map this
  // code never built.
  const truth = new Map<string, Row>()
  for (const r of oracle) if (r.type === type) truth.set(`${r.file}|${r.key}`, r)
  const obs = new Map<string, Row>()
  for (const r of observed) if (r.type === type) obs.set(`${r.file}|${r.key}`, r)
  let tp = 0, fp = 0, fn = 0, lineAgree = 0, confAgree = 0
  const fpEx: string[] = [], fnEx: string[] = []
  for (const [k, t] of truth) {
    const o = obs.get(k)
    if (!o) { fn++; if (fnEx.length < 6) fnEx.push(`${t.file} ${k.replace("|", " -> ")}`); continue }
    tp++
    if (o.line === t.line) lineAgree++
    if (o.conf === t.conf) confAgree++
    if (o.meta !== t.meta && fpEx.length < 6) fpEx.push(`META ${k.replace("|", " -> ")}  oracle[${t.meta}] analyzer[${o.meta}]`)
  }
  for (const [k, o] of obs) if (!truth.has(k)) { fp++; if (fpEx.length < 6) fpEx.push(`${o.file} ${k.replace("|", " -> ")}`) }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
  return { truth: truth.size, emitted: obs.size, tp, fp, fn, lineAgree, confAgree, precision, recall, fpEx, fnEx }
}

console.log(`JAVA IMPORT/EXPORT ORACLE (EXPORTS_JAVA2)`)
console.log(`corpus ${REPO_DIR}: ${all.length} .java files on disk (derived by readdir), measuring ${files.length}, ${ms} ms, ${CONC} workers`)
console.log(`parse/analyze failures: ${parseFail}`)
console.log(`oracle rows: imports ${oracle.filter((r) => r.type === "imports").length} · exports ${oracle.filter((r) => r.type === "exports").length}`)
console.log(`analyzer rows typed imports/exports: ${observed.filter((r) => r.type === "imports").length} / ${observed.filter((r) => r.type === "exports").length}`)
console.log(`\nINDEPENDENCE LIMIT: both walkers load the same tree-sitter-java wasm, so a bug IN THE GRAMMAR is invisible to this oracle exactly as it is to the shared differential. This measures implementation divergence, not grammar correctness.\n`)

console.log("type      truth   emitted     TP     FP     FN   precision   recall   line-agree  conf-agree")
console.log("-".repeat(112))
for (const t of ["imports", "exports"] as const) {
  const r = adjudicate(t)
  console.log(
    `${t.padEnd(9)} ${String(r.truth).padStart(5)} ${String(r.emitted).padStart(9)} ${String(r.tp).padStart(6)} ${String(r.fp).padStart(6)} ${String(r.fn).padStart(6)}   ${r.precision.toFixed(4)}   ${r.recall.toFixed(4)}   ${String(r.lineAgree)}/${r.tp}        ${String(r.confAgree)}/${r.tp}`,
  )
  for (const e of r.fpEx) console.log(`     ${e}`)
  for (const e of r.fnEx) console.log(`     MISSING ${e}`)
}
console.log(`\nDERIVATION DEBT FOR THIS LANE, restated against the measurement above:`)
console.log(`  exports  and  imports  are NOT in the shared differential's java audited set`)
console.log(`  (["calls","contains","extends","implements","instantiates","overrides","references","uses"]),`)
console.log(`  which is why this oracle exists. Registering it needs a one-line change to a MASTER-owned file:`)
console.log(`  script/m60/rel-type-coverage-gate.ts reads a lane's own audited set from`)
console.log(`  script/m14/<lang>-truth.ts when that file exports ORACLE_LABELS (gate lines 186-201).`)
console.log(`  script/m14/** is MASTER-owned, so this lane did not create it.`)
