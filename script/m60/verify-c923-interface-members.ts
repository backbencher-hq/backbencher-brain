// script/m60/verify-c923-interface-members.ts — the CORPUS ACCOUNTING for csharp #923.
//
// Two instruments, independent by construction:
//
//   TREE SIDE    parses each file with the pinned csharp grammar and DERIVES the member-level
//                interface edges (explicit always; implicit only against an interface declared
//                in the same file — the shipped rule)
//   LANE SIDE    drives the REAL analyzer through ASTEngine.parseFile on the same file and keeps
//                the edges it publishes with metadata.relationshipType = "interface_member_
//                implementation"
//
// The reconciliation is edge-level and BOTH directions: a tree edge the lane does not publish is
// MISSING; a lane edge the tree does not derive is FABRICATED. Counts must agree per file, not in
// aggregate, so two opposite errors cannot cancel.
//
// Scope: both pinned corpora, at their FULL EXTENT (every .cs file they contain), because the
// pinned draws are 40 + 24 files and the census measured only 3 explicit + 2 implicit candidates
// there — a draw too small to convict anything. The pinned-draw figures are printed separately so
// the scope limit is stated rather than implied.
//
// Run: bun script/m60/verify-c923-interface-members.ts [--pinned]
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const CENSUS = path.join(ROOT, "validation", "m60", "results", "c923-interface-members.json")
const PINNED = process.argv.includes("--pinned")

const TYPE_DECLS = new Set(["class_declaration", "struct_declaration", "record_declaration", "interface_declaration"])
// Indexers are members of the contract like any other: the lane names an indexer symbol `this`,
// so `PSDataCollection.this -> IList.this` is the edge its own symbol spelling produces. Leaving
// indexers out of the derivation made the instrument report 3 real edges as fabrication.
const MEMBER_DECLS = new Set(["method_declaration", "property_declaration", "event_declaration", "event_field_declaration", "indexer_declaration"])

interface TreeType { kind: string; name: string; bases: string[]; members: Array<{ name: string; explicitIface: string | null }> }

function nameOf(node: any): string | null {
  const n = node.childForFieldName?.("name")
  if (n && typeof n.text === "string") return n.text
  if (node.type === "indexer_declaration") return "this"
  // Field-like events (and fields) carry their name on the `variable_declarator`.
  if (node.type === "event_field_declaration" || node.type === "field_declaration") {
    const vd = node.namedChildren?.find?.((c: any) => c.type === "variable_declaration")
    const decl = vd?.namedChildren?.find?.((c: any) => c.type === "variable_declarator")
    const id = decl?.namedChildren?.find?.((c: any) => c.type === "identifier")
    if (id && typeof id.text === "string") return id.text
  }
  const id = node.namedChildren?.find?.((c: any) => c.type === "identifier" || c.type === "generic_name")
  return id && typeof id.text === "string" ? id.text : null
}

/** The base-list entries as WRITTEN, leaf-cleaned (mirrors the analyzer's cleanTypeName + leaf). */
function baseList(node: any, baseLeafName: (s: string) => string): string[] {
  const out: string[] = []
  const bl = node.namedChildren?.find?.((c: any) => c.type === "base_list")
  for (const b of bl?.namedChildren ?? []) {
    if (b.type === "argument_list") continue
    const tn = b.type === "primary_constructor_base_type"
      ? (b.namedChildren ?? []).find((c: any) => c.type === "identifier" || c.type === "generic_name")
      : b
    if (tn && typeof tn.text === "string") out.push(baseLeafName(tn.text))
  }
  return out
}

function explicitIfaceOf(member: any, explicitInterfaceName: (s: string) => string): string | null {
  const spec = (member.namedChildren ?? []).find((c: any) => c.type === "explicit_interface_specifier")
  return spec ? explicitInterfaceName(spec.text) : null
}

function collectTypes(root: any, baseLeafName: (s: string) => string, explicitInterfaceName: (s: string) => string): TreeType[] {
  const out: TreeType[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (TYPE_DECLS.has(node.type)) {
      const name = nameOf(node)
      if (name) {
        // Descend through EVERY descendant of the type except nested type declarations, not just
        // the direct children of `declaration_list`: a member inside `#if`/`#region` sits under a
        // `preproc_if` node, and powershell's ConsoleHost.cs is exactly that shape — the four
        // explicit `IHostProvidesTelemetryData.*` properties the lane publishes were INVISIBLE to
        // the first version of this instrument, which reported them as fabrication.
        const members: Array<{ name: string; explicitIface: string | null }> = []
        const inner: any[] = (node.namedChildren ?? []).slice()
        while (inner.length > 0) {
          const m = inner.pop()!
          if (m !== node && TYPE_DECLS.has(m.type)) continue
          if (MEMBER_DECLS.has(m.type) && m !== node) {
            const n = nameOf(m)
            if (n) members.push({ name: n, explicitIface: explicitIfaceOf(m, explicitInterfaceName) })
            continue
          }
          for (const c of m.namedChildren ?? []) inner.push(c)
        }
        out.push({ kind: node.type, name, bases: baseList(node, baseLeafName), members })
      }
    }
    for (const c of node.namedChildren ?? []) stack.push(c)
  }
  return out
}

/**
 * The edges the SHIPPED RULE requires for one file. `localLabel` mirrors the analyzer's
 * `localEdgeLabel` (drop balanced parens, keep the last two segments), so the comparison is of
 * published labels, not of internal names.
 */
/**
 * `counters` (optional, mutated) separates DECLARATIONS from DISTINCT EDGES: two explicit
 * overloads with the same (owner, member) pair are two declarations but one edge, and the
 * census counts declarations while the lane publishes edges. Reporting both is what makes the
 * reconciliation a measurement instead of an excuse.
 */
export function deriveEdges(
  types: TreeType[],
  localLabel: (s: string) => string,
  counters?: { declarations: number; explicitDeclarations: number },
): Array<{ source: string; target: string; form: "explicit" | "implicit" }> {
  // Declared contracts, keyed by declared name AND by every name a base list might write.
  const ifaceMembers = new Map<string, Set<string>>()
  const classMembers = new Map<string, Set<string>>()
  const typeByName = new Map<string, TreeType>()
  for (const t of types) {
    if (!typeByName.has(t.name)) typeByName.set(t.name, t)
    if (t.kind !== "interface_declaration") {
      let cs = classMembers.get(t.name)
      if (!cs) { cs = new Set<string>(); classMembers.set(t.name, cs) }
      for (const m of t.members) cs.add(m.name)
      continue
    }
    let set = ifaceMembers.get(t.name)
    if (!set) { set = new Set<string>(); ifaceMembers.set(t.name, set) }
    for (const m of t.members) set.add(m.name)
  }
  const out: Array<{ source: string; target: string; form: "explicit" | "implicit" }> = []
  const seen = new Set<string>()
  for (const t of types) {
    if (t.kind === "interface_declaration") continue
    for (const m of t.members) {
      let target: string | null = null
      let form: "explicit" | "implicit" = "implicit"
      if (m.explicitIface) {
        target = `${m.explicitIface}.${m.name}`
        form = "explicit"
      } else if (t.bases.length > 0) {
        // BFS in declaration order over IN-FILE declared ancestors: the first interface that
        // declares the member owns it (the shipped rule, transitively through in-file bases).
        const queue = [...t.bases]
        const visited = new Set<string>()
        while (queue.length > 0) {
          const parent = queue.shift()!
          if (visited.has(parent)) continue
          visited.add(parent)
          if (ifaceMembers.get(parent)?.has(m.name)) { target = `${parent}.${m.name}`; break }
          // A base class that declares the member already fills the interface slot: the path stops
          // there (the shipped rule — see RealCSharpAnalyzer.resolveInterfaceImplementations).
          if (classMembers.get(parent)?.has(m.name)) continue
          const next = typeByName.get(parent)
          for (const b of next?.bases ?? []) if (!visited.has(b)) queue.push(b)
        }
      }
      if (!target) continue
      const source = localLabel(`${t.name}.${m.name}`)
      const label = localLabel(target)
      const key = `${source}|${label}`
      if (counters) {
        counters.declarations++
        if (form === "explicit") counters.explicitDeclarations++
      }
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ source, target: label, form })
    }
  }
  return out
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const { LANGS, LANG_REPOS, SECOND_CORPUS } = await import("../m14/differential.ts")
  const { filesFor } = await import("./target-spelling-census.ts")
  const { baseLeafName, explicitInterfaceName } = await import("./c923-interface-member-census.ts")
  const { deriveCSharpEdges } = await import("../m14/differential.ts")
  const { localEdgeLabel } = await import("../../src/ast/override-context.ts")

  const lang = "csharp"
  const cfg = LANGS[lang]
  const language = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
  const parser = new ParserClass()
  parser.setLanguage(language)

  const draws: Array<{ repo: string; files: string[] }> = []
  for (const [repo, cap] of [[LANG_REPOS[lang], PINNED ? 40 : 1_000_000], [SECOND_CORPUS[lang], PINNED ? 24 : 1_000_000]] as Array<[string, number]>) {
    if (!repo) continue
    const files = filesFor(lang, repo, cap)
    if (files.length) draws.push({ repo, files })
  }

  const tally = {
    files: 0, treeEdges: 0, laneEdges: 0, oracleEdges: 0, explicit: 0, implicit: 0,
    missing: 0, fabricated: 0, parseFailures: 0, oracleMissing: 0, oracleExtra: 0,
    treeDeclarations: 0, treeExplicitDeclarations: 0,
  }
  const samples = { missing: [] as any[], fabricated: [] as any[], oracleMissing: [] as any[], oracleExtra: [] as any[] }

  for (const draw of draws) {
    for (const file of draw.files) {
      let src: string
      try { src = fs.readFileSync(file, "utf8") } catch { continue }
      const tree = parser.parse(src)
      if (!tree?.rootNode) { tally.parseFailures++; continue }
      tally.files++
      const types = collectTypes(tree.rootNode, baseLeafName, explicitInterfaceName)
      const counters = { declarations: 0, explicitDeclarations: 0 }
      const expected = deriveEdges(types, localEdgeLabel, counters)
      tally.treeDeclarations += counters.declarations
      tally.treeExplicitDeclarations += counters.explicitDeclarations

      const res: any = await (await import("../../src/ast/engine.ts")).ASTEngine.parseFile(file, src)
      const actual: Array<{ source: string; target: string }> = []
      const seenActual = new Set<string>()
      for (const r of res.relationships ?? []) {
        if (r?.metadata?.relationshipType !== "interface_member_implementation") continue
        const key = `${r.source}|${r.target}`
        if (seenActual.has(key)) continue
        seenActual.add(key)
        actual.push({ source: String(r.source), target: String(r.target) })
      }

      // Third side: the differential's own oracle (script/m14/differential.ts), which this round
      // mirrors in the SAME commit. Comparing it against the lane is the "oracle mirrors the rule"
      // check the DoD asks for — and the disclosure is that a mirror cannot adjudicate the rule it
      // mirrors, which is why the tree side above and the fixture stand beside it.
      const oracleEdges = deriveCSharpEdges(tree.rootNode)
        .filter((e: any) => e.label === "overrides")
        .map((e: any) => ({ source: String(e.from), target: String(e.target) }))

      const rel = path.relative(path.join(CORPUS_ROOT, draw.repo), file)
      tally.treeEdges += expected.length
      tally.laneEdges += actual.length
      tally.oracleEdges += oracleEdges.length
      for (const o of oracleEdges) {
        if (!actual.some((a) => a.source === o.source && a.target === o.target)) {
          tally.oracleMissing++
          if (samples.oracleMissing.length < 10) samples.oracleMissing.push({ file: `${draw.repo}/${rel}`, ...o })
        }
      }
      for (const a of actual) {
        if (!oracleEdges.some((o: any) => o.source === a.source && o.target === a.target)) {
          tally.oracleExtra++
          if (samples.oracleExtra.length < 10) samples.oracleExtra.push({ file: `${draw.repo}/${rel}`, ...a })
        }
      }
      for (const e of expected) if (e.form === "explicit") tally.explicit++
      for (const e of expected) {
        const hit = actual.some((a) => a.source === e.source && a.target === e.target)
        if (!hit) {
          tally.missing++
          if (samples.missing.length < 20) samples.missing.push({ file: `${draw.repo}/${rel}`, ...e })
        }
      }
      for (const a of actual) {
        const hit = expected.some((e) => e.source === a.source && e.target === a.target)
        if (!hit) {
          tally.fabricated++
          if (samples.fabricated.length < 20) samples.fabricated.push({ file: `${draw.repo}/${rel}`, ...a })
        }
      }
    }
  }
  tally.implicit = tally.treeEdges - tally.explicit

  // The census's own, independently parsed counts (the boundary measurement).
  let census: any = null
  try { census = JSON.parse(fs.readFileSync(CENSUS, "utf8")) } catch { /* reported below */ }
  // Compare like with like: the pinned draws are the census's own `combined`, the full extent its
  // `fullExtent.combined`. Comparing a 64-file draw against 1,518-file numbers would report a
  // "difference" that is only a scope mismatch.
  const c = PINNED ? (census?.combined ?? null) : (census?.fullExtent?.combined ?? null)

  console.log(`scope: ${PINNED ? "PINNED DRAWS" : "FULL EXTENT"} — ${tally.files} files, ${tally.parseFailures} parse failures`)
  console.log(`  tree-derived edges   ${tally.treeEdges}  (explicit ${tally.explicit}, implicit ${tally.implicit})`)
  console.log(`  lane-published edges ${tally.laneEdges}`)
  console.log(`  MISSING ${tally.missing}   FABRICATED ${tally.fabricated}`)
  console.log(`  oracle-derived edges ${tally.oracleEdges}  (vs lane: oracle-only ${tally.oracleMissing}, lane-only ${tally.oracleExtra})`)
  if (c) {
    console.log(`  census (independent parse): explicit DECLARATIONS ${c.explicit.count} (${c.explicit.inInterfaceDeclarations ?? 0} of them inside interface declarations, excluded), implicit-locallyResolved ${c.implicit.locallyResolved}, implicit-crossFileOnly ${c.implicit.crossFileOnly}, external-contract types ${c.implicit.typesExternalOnly}`)
    const explicitDeclDelta = c.explicit.count - tally.treeExplicitDeclarations
    const explicitEdgeDelta = c.explicit.count - tally.explicit
    console.log(`  census reconciliation:`)
    console.log(`    explicit declarations: census ${c.explicit.count} vs tree ${tally.treeExplicitDeclarations} ${explicitDeclDelta === 0 ? "EXACT" : `DIFFERS by ${explicitDeclDelta}`}`)
    console.log(`    explicit DISTINCT EDGES: tree ${tally.explicit} — the ${explicitEdgeDelta} fewer than declarations are repeated (owner,member) pairs (overloads collapsing to one edge), which is what the lane publishes too`)
    console.log(`    implicit: tree ${tally.implicit} vs census locallyResolved ${c.implicit.locallyResolved} — the census counts every direct-base NAME match; the shipped rule additionally refuses a match a base CLASS already fills, so a shortfall here is that refusal and an excess is a chain/transitive match`)
  } else {
    console.log("  census artifact absent — run: bun script/m60/c923-interface-member-census.ts --full --emit")
  }
  for (const s of samples.missing) console.log(`    MISSING    ${s.file}  ${s.source} -> ${s.target} [${s.form}]`)
  for (const s of samples.fabricated) console.log(`    FABRICATED ${s.file}  ${s.source} -> ${s.target}`)
  for (const s of samples.oracleMissing) console.log(`    ORACLE-ONLY ${s.file}  ${s.source} -> ${s.target}`)
  for (const s of samples.oracleExtra) console.log(`    LANE-ONLY   ${s.file}  ${s.source} -> ${s.target}`)
  if (tally.missing || tally.fabricated || tally.oracleMissing || tally.oracleExtra) process.exitCode = 1
}

if (import.meta.main) await main()
