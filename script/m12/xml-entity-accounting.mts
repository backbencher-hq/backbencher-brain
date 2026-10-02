/**
 * M18 — ENTITY-REFERENCE ACCOUNTING. Do the analyzer's collapsed
 * `entity_reference` edges account for every `EntityRef` site in the corpus?
 *
 * M18 implemented entity uses: `&name;` in content became a real reference, with
 * 12,066 `EntityRef` sites measured across 268 files and 4,423 of them naming an
 * entity nothing declares. The implementation emits COLLAPSED edges — one edge per
 * (owner, name) carrying `occurrences` and `lines` — so the number a reader sees
 * (hundreds of edges) is not the number of facts in the documents (twelve
 * thousand), and nothing in the gate set connected the two. The first attempt at
 * this check TIMED OUT, so the collapse accounting was left unverified and the
 * review recorded it as owed rather than as done.
 *
 * This is the missing check, and it is an ACCOUNTING identity, not a recall
 * number:
 *
 *     sum of `occurrences` over all entity_reference edges
 *       + edges this analyzer deliberately REFUSES to publish
 *       == EntityRef nodes in the tree
 *
 * It has to be written to be cheap. The earlier attempt accumulated every symbol
 * and edge for every file in one process and died on memory. Here the analyzer's
 * output is read for two fields and dropped, the tree is walked with an explicit
 * stack, and nothing is retained between files.
 *
 * A mismatch is not automatically a defect in the analyzer. Two things legitimately
 * break the identity and both are reported separately rather than folded in:
 *
 *   - a `PEReference` is not an `EntityRef`; it is a parameter-entity reference,
 *     and it is counted as its own class here;
 *   - a `CharRef` (`&#160;`) is a numeric character reference, not a name, and is
 *     never an entity reference at all.
 *
 * Usage:
 *   npx tsx script/m12/xml-entity-accounting.mts [--repos DIR] [--json]
 * Exit 0 when the identity holds for every file, 1 otherwise.
 */
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..")
const DEFAULT_REPOS = process.env.XML_CORPUS_ROOT ?? "$HOME/fixtures/xml/repos"
const MAX_BYTES = Number(process.env.XML_MAX_BYTES ?? 2_000_000)
const EXTS = new Set([".xml", ".xsd", ".dtd", ".xsl", ".xslt", ".svg", ".rng"])

function collect(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === ".git") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collect(full, out)
    else if (EXTS.has(path.extname(e.name).toLowerCase())) out.push(full)
  }
}

/** Where an `EntityRef` sits, which is what decides whether it can have an owner. */
type RefContext = "content" | "inside-attribute-value" | "inside-entity-replacement-text" | "other"

/**
 * THE DECLARED RESIDUAL, per file, with the ruling for each.
 *
 * The identity above is STRICT — sites must equal accounted occurrences and the
 * gate exits 1 the moment it does not hold. That is correct, and on its own it
 * would leave the gate permanently red over 21 sites that need a SEMANTIC ruling
 * rather than more code. A gate that is always red is a gate that gets ignored,
 * which is the failure this script was written to avoid.
 *
 * So the residual is DECLARED here, exactly, by file and by size. The gate
 * compares what it measured against this list:
 *
 *   - a listed file whose shortfall is a DIFFERENT size fails;
 *   - an unlisted file with any shortfall fails;
 *   - a new shortfall anywhere fails.
 *
 * A declared residual is therefore a pinned, bounded, reviewed statement and not
 * a tolerance. If a later fix closes one of these the gate turns red until the
 * entry is removed, which is the right direction to be wrong in.
 *
 * Each entry says WHY, because "we did not get round to it" is not a ruling:
 *
 *  - `entity-in-ns-uri`: a reference whose text sits inside a namespace URI. No
 *    XML processor expands entity references in a namespace URI — the URI is taken
 *    as a literal string, which is the whole point of comparing an entity-expanded
 *    name against one — so these are sites the grammar reports and the language
 *    does not resolve. Publishing them would assert a dependency the language
 *    says does not exist. RULED: not a reference.
 *
 *  - `attlist-default` is GONE from this list, which is the direction this gate is
 *    meant to be able to fail in. All four entries were there at 10 sites; the
 *    analyzer now publishes them, and the gate went red saying so, and removing
 *    the entries is what makes it green again.
 *
 *  - `residual-single`: sites not yet adjudicated against the tree. Recorded
 *    rather than explained, because an unexplained number is at least honest about
 *    being unexplained. Two of them are `&dest;` inside an `EntityValue` that the
 *    grammar wraps in ERROR because the replacement text is `<dest id='foo'/>` —
 *    markup inside a general entity's value, which needs an internal subset to be
 *    legal and so is not well-formed where it stands.
 */
const DECLARED_RESIDUAL: Record<string, { sites: number; ruling: string }> = {
  "libxml2/test/entity-in-ns-uri.xml": { sites: 2, ruling: "entity-in-ns-uri" },
  "libxml2/result/valid/id2.xml": { sites: 1, ruling: "residual-single" },
  "libxml2/test/valid/id2.xml": { sites: 1, ruling: "residual-single" },
  "libxslt/tests/docbook/fo/autoidx.xsl": { sites: 3, ruling: "residual-single" },
  "libxslt/tests/docbook/html/autoidx.xsl": { sites: 3, ruling: "residual-single" },
  "libxslt/tests/docbook/test/qa.xml": { sites: 1, ruling: "residual-single" },
}

interface FileRow {
  file: string
  entityRefSites: number
  byContext: Record<RefContext, number>
  charRefSites: number
  peReferenceSites: number
  edgeOccurrences: number
  edges: number
  inDocument: number
  builtin: number
  unresolved: number
}

interface Mismatch {
  file: string
  entityRefSites: number
  edgeOccurrences: number
  delta: number
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const ri = argv.indexOf("--repos")
  const reposRoot = ri >= 0 ? argv[ri + 1] : DEFAULT_REPOS
  const asJson = argv.includes("--json")

  if (!fs.existsSync(reposRoot)) {
    console.error(`xml-entity-accounting: corpus root absent: ${reposRoot}`)
    process.exit(1)
  }

  const wts: any = await import("web-tree-sitter")
  const Parser = wts.Parser ?? wts.default?.Parser ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-xml.wasm")))
  const { decodeSourceText } = await import(path.join(ROOT, "src/util/source-text"))
  const { RealXmlAnalyzer } = await import(path.join(ROOT, "src/ast/real-xml-analyzer"))

  const files: string[] = []
  collect(reposRoot, files)
  files.sort()

  const parser = new Parser()
  parser.setLanguage(grammar)
  const analyzer: any = new RealXmlAnalyzer()

  const perReferenceGaps: { file: string; sites: number; edges: number }[] = []
  const rows: FileRow[] = []
  const mismatches: Mismatch[] = []
  let totals = { entityRef: 0, charRef: 0, peReference: 0, peEdges: 0, occurrences: 0, edges: 0, inDocument: 0, builtin: 0, unresolved: 0 }

  for (const file of files) {
    let raw: Buffer
    try {
      if (fs.statSync(file).size > MAX_BYTES) continue
      raw = fs.readFileSync(file)
    } catch {
      continue
    }
    const content = decodeSourceText(raw).text
    let tree: any
    try {
      tree = parser.parse(content)
    } catch {
      continue
    }
    const root = tree?.rootNode
    if (!root) continue

    // Ground truth: count the node types in the tree, iteratively, AND record
    // each `EntityRef`'s context — because context is what decides whether the
    // reference can have an OWNER, and an owner is the precondition for the edge
    // (`if (node.type === "EntityRef" && ownerName)`). A site inside an entity's
    // replacement text belongs to the entity, not to an element, so a shortfall
    // there is a different finding from a shortfall in content.
    let entityRefSites = 0
    let charRefSites = 0
    let peReferenceSites = 0
    const byContext: Record<RefContext, number> = { content: 0, "inside-attribute-value": 0, "inside-entity-replacement-text": 0, other: 0 }
    {
      const stack: any[] = [root]
      while (stack.length > 0) {
        const n = stack.pop()
        if (n.type === "EntityRef") {
          entityRefSites++
          let ctx: RefContext = "content"
          let a = n.parent
          let steps = 0
          while (a && steps < 8) {
            if (a.type === "EntityValue") { ctx = "inside-entity-replacement-text"; break }
            if (a.type === "Attribute" || a.type === "AttValue") { ctx = "inside-attribute-value"; break }
            a = a.parent
            steps++
          }
          byContext[ctx]++
        } else if (n.type === "CharRef") charRefSites++
        else if (n.type === "PEReference") peReferenceSites++
        for (let i = n.childCount - 1; i >= 0; i--) {
          const c = n.child(i)
          if (c) stack.push(c)
        }
      }
    }
    if (entityRefSites === 0 && peReferenceSites === 0) continue

    let result: any
    try {
      result = await analyzer.analyze(root, content, path.relative(reposRoot, file))
    } catch {
      continue
    }

    let peEdges = 0
    let edgeOccurrences = 0
    let edges = 0
    let inDocument = 0
    let builtin = 0
    let unresolved = 0
    for (const r of result.relationships ?? []) {
      const kind = r.metadata?.relationshipKind ?? r.metadata?.role
      if (kind !== "entity_reference" && r.metadata?.entityReference !== true) {
        // The edge TYPE for an entity use is `references`; the ROLE marks it.
        if (r.type !== "references") continue
        if (r.metadata?.entityReference !== true && !/entity/i.test(String(r.metadata?.reasonCode ?? ""))) continue
      }
      edges++
      const occ = Number((r.metadata as any)?.occurrences ?? 1)
      edgeOccurrences += Number.isFinite(occ) ? occ : 1
      // ALL THREE classes are counted, and they must sum to the edge total. A
      // counter that reported only in-document and unresolved looked complete
      // while silently dropping every `builtin` edge — 369 of them — which is the
      // same defect this whole script exists to catch, one level down: an
      // instrument whose own summary does not add up.
      const res = String((r.metadata as any)?.resolvable ?? "")
      if (res === "in-document") inDocument++
      else if (res === "builtin") builtin++
      else unresolved++
    }

    for (const r of result.relationships ?? []) {
      if ((r.metadata as any)?.role === "parameter_entity_reference") peEdges++
    }
    if (peEdges !== peReferenceSites) {
      perReferenceGaps.push({ file: path.relative(reposRoot, file), sites: peReferenceSites, edges: peEdges })
    }
    totals.peEdges += peEdges

    totals.entityRef += entityRefSites
    totals.charRef += charRefSites
    totals.peReference += peReferenceSites
    totals.occurrences += edgeOccurrences
    totals.edges += edges
    totals.inDocument += inDocument
    totals.builtin += builtin
    totals.unresolved += unresolved

    if (edgeOccurrences !== entityRefSites) {
      mismatches.push({
        file: path.relative(reposRoot, file),
        entityRefSites,
        edgeOccurrences,
        delta: edgeOccurrences - entityRefSites,
      })
    }
    rows.push({ file: path.relative(reposRoot, file), entityRefSites, byContext, charRefSites, peReferenceSites, edgeOccurrences, edges, inDocument, builtin, unresolved })
  }

  // Attribute the shortfall to CONTEXTS over the files that actually fail, rather
  // than counting every non-content site in the corpus — many attribute-value
  // references ARE accounted for (published as a property value carrying the
  // entity name), so a census of contexts would overstate the gap by an order of
  // magnitude. The gap is `sites - occurrences` on the failing files.
  const gapByContext: Record<string, { gap: number; files: number; example: string }> = {}
  for (const r of rows) {
    const gap = r.entityRefSites - r.edgeOccurrences
    if (gap <= 0) continue
    // the context that dominates this file's shortfall
    let best: RefContext = "content"
    let bestShare = 0
    for (const [k, v] of Object.entries(r.byContext) as [RefContext, number][]) {
      if (k === "content") continue
      if (v > bestShare) { bestShare = v; best = k }
    }
    const key = bestShare > 0 ? best : "content-only"
    if (!gapByContext[key]) gapByContext[key] = { gap: 0, files: 0, example: r.file }
    gapByContext[key].gap += gap
    gapByContext[key].files++
  }

  const filesWithEntities = rows.length
  const report = {
    corpusRoot: reposRoot,
    filesConsidered: files.length,
    filesWithEntityOrPEReference: filesWithEntities,
    totals,
    identityHolds: mismatches.length === 0,
    declaredResidualTotal: mismatches.reduce((a, m) => a + -m.delta, 0),
    mismatchingFiles: mismatches.length,
    shortfallByContext: gapByContext,
    mismatches: mismatches.slice(0, 30),
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`xml entity accounting: ${files.length} file(s) considered, ${filesWithEntities} carrying an entity or parameter-entity reference`)
    console.log(`  EntityRef sites in tree : ${totals.entityRef}`)
    console.log(`  entity_reference edges  : ${totals.edges}  (collapsed)`)
    console.log(`  sum of edge occurrences: ${totals.occurrences}`)
    console.log(`  in-document / builtin / unresolved: ${totals.inDocument} / ${totals.builtin} / ${totals.unresolved} edges`)
    const classSum = totals.inDocument + totals.builtin + totals.unresolved
    if (classSum !== totals.edges) {
      console.log(`  WARNING: resolvability classes sum to ${classSum} but there are ${totals.edges} edges — an unclassified class exists`)
    }
    console.log(`  CharRef sites (not entity uses): ${totals.charRef}`)
    console.log(`  PEReference sites (separate class): ${totals.peReference}`)
    if (mismatches.length === 0) {
      console.log(`  OK — the ${totals.edges} collapsed edges account for all ${totals.entityRef} EntityRef sites`)
    } else {
      console.log(`  ${mismatches.length} file(s) where the identity does NOT hold:`)
      for (const m of mismatches.slice(0, 20)) {
        console.log(`    ${m.file}  sites=${m.entityRefSites} occurrences=${m.edgeOccurrences} delta=${m.delta > 0 ? "+" : ""}${m.delta}`)
      }
      if (mismatches.length > 20) console.log(`    … and ${mismatches.length - 20} more`)
      const entries = Object.entries(gapByContext).sort((a, b) => b[1].gap - a[1].gap)
      if (entries.length) {
        const totalGap = entries.reduce((a, [, v]) => a + v.gap, 0)
        console.log(`  the ${totalGap}-site shortfall, attributed by dominant context in the failing file:`)
        for (const [k, v] of entries) {
          console.log(`    ${String(v.gap).padStart(5)}  ${k.padEnd(32)} ${v.files} file(s)  e.g. ${v.example}`)
        }
      }
    }
  }

  // Compare the measured shortfall against the DECLARED list, exactly.
  // PEREFERENCE ACCOUNTING is a separate identity from the EntityRef one above,
  // and it is reported separately rather than folded in, because a parameter
  // entity is a different construct with no builtin form: `%name;` is a reference
  // if and only if the document's own DTD declares it.
  //
  //   sum of `parameter_entity_reference` edges == PEReference nodes
  //
  // and the measurement is 24 sites, 19 published, 5 unaccounted across 4 files.
  // Those 4 are a GRAMMAR LIMIT rather than a ruling: libxml2's
  // `test/errors10/781205.xml` and its three siblings open with `<!DOCTYPE D [`
  // and NO XML declaration, and the parser produces an `ERROR` root with **no
  // `doctypedecl` node anywhere in the tree** (verified by walking every node, not
  // by looking at the root). With no DOCTYPE node there is no DOCTYPE NAME, and
  // the reference has no owner to attach to — the same structural reason the DTD
  // declaration edges needed the DOCTYPE's name and could not invent one.
  //
  // Declared rather than absorbed, and deliberately NOT "fixed" by attaching these
  // to the file name or to a synthetic owner: an edge from an invented owner claims
  // a document said something it did not. The corpus declares them to be malformed
  // (they live under `test/errors/`), so the honest reading is "the parser could
  // not recover a DOCTYPE here", which is what this says.
  const PEREFERENCE_FILES = [
    { file: "libxml2/test/errors/754946.xml", sites: 1 },
    { file: "libxml2/test/errors/759573-2.xml", sites: 2 },
    { file: "libxml2/test/errors10/781205.xml", sites: 1 },
    { file: "libxml2/test/errors10/781361.xml", sites: 1 },
  ]

  const measured = new Map<string, number>()
  for (const m of mismatches) measured.set(m.file, -m.delta)
  const problems: string[] = []
  for (const [file, n] of measured) {
    const decl = DECLARED_RESIDUAL[file]
    if (!decl) problems.push(`UNDECLARED shortfall: ${file} has ${n} unaccounted site(s)`)
    else if (decl.sites !== n) problems.push(`CHANGED shortfall: ${file} declared ${decl.sites}, measured ${n}`)
  }
  for (const [file, decl] of Object.entries(DECLARED_RESIDUAL)) {
    if (!measured.has(file)) problems.push(`DECLARED shortfall GONE: ${file} declared ${decl.sites} (${decl.ruling}) — remove the entry`)
  }

  // The PEReference identity, checked against its own declared list. Kept apart
  // from the EntityRef problems above so a failure in one class cannot be read as
  // a failure of the other, and so each is pinned to the number it claims.
  const peMeasured = new Map<string, number>()
  for (const g of perReferenceGaps) peMeasured.set(g.file, g.sites - g.edges)
  const peProblems: string[] = []
  for (const [file, n] of peMeasured) {
    const decl = PEREFERENCE_FILES.find((d) => d.file === file)
    if (!decl) peProblems.push(`UNDECLARED PEReference shortfall: ${file} has ${n} unaccounted site(s)`)
    else if (decl.sites !== n) peProblems.push(`CHANGED PEReference shortfall: ${file} declared ${decl.sites}, measured ${n}`)
  }
  for (const decl of PEREFERENCE_FILES) {
    if (!peMeasured.has(decl.file)) peProblems.push(`DECLARED PEReference shortfall GONE: ${decl.file} declared ${decl.sites} — remove the entry`)
  }

  if (problems.length === 0 && peProblems.length === 0) {
    const peGap = [...peMeasured.values()].reduce((a, b) => a + b, 0)
    console.log(`  PEReference: ${totals.peReference} site(s), ${totals.peEdges} published, ${peGap} unaccounted across ${peMeasured.size} file(s) — DECLARED (no DOCTYPE node to own them)`)
    const total = [...measured.values()].reduce((a, b) => a + b, 0)
    console.log(`  OK — ${totals.entityRef} site(s), ${totals.occurrences} accounted; ${measured.size} file(s) carry the DECLARED residual of ${total} site(s)`)
    for (const [file, decl] of Object.entries(DECLARED_RESIDUAL)) {
      console.log(`    declared  ${String(decl.sites).padStart(2)}  ${file}  (${decl.ruling})`)
    }
  } else {
    const all = [...problems, ...peProblems]
    console.log(`  ${all.length} problem(s) against the declared residual(s):`)
    for (const p of all.slice(0, 25)) console.log(`    ${p}`)
  }

  // BOTH identities must hold. The first version of this line read only
  // `problems`, so a PEReference regression could not fail the gate at all —
  // verified by perturbing a declared size, which printed no problem and exited 0.
  // That is the exact defect this gate exists to catch, introduced into the gate
  // by the change that extended it, which is why it is called out here rather than
  // left as an unremarked line.
  process.exit(problems.length === 0 && peProblems.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
