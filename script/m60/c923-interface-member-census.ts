// script/m60/c923-interface-member-census.ts — the MEASUREMENT behind csharp #923's boundary decision.
//
// THE QUESTION
// ------------
// csharp publishes no member-level edge between a class member and the interface member it
// implements, in either form:
//
//   explicit   `int IVsProjectFlavorCfg.get_CfgType(ref Guid, out IntPtr)`  — the interface is
//              WRITTEN in the source, so the edge is derivable from the tree alone
//   implicit   `public int Count => 1` satisfying `int Count { get; }` on an interface in the
//              type's base list — needs the interface's MEMBER SET to know it is an implementation
//              and not an unrelated member
//
// #923's DoD says the boundary ("explicit always, implicit only where the interface is locally
// declared" is the hypothesis) must be decided ON MEASUREMENT, with the implicit case's corpus
// reality recorded — how many interface members resolve locally vs not. This script is that
// measurement, and it is the instrument the round's doc cites.
//
// WHAT IS MEASURED, per pinned corpus and combined
// -----------------------------------------------
//   explicit.parents        every `explicit_interface_specifier`, histogrammed by its PARENT node
//                           type — which member kinds the grammar can even carry one on
//   explicit.byKind         those members by declaration kind
//   explicit.ownerResolves  the named interface is declared IN THE SAME FILE (the member's own
//                           file) / ELSEWHERE IN THE DRAW / NOT AT ALL in the draw's text. The
//                           middle bucket is the one a per-file analyzer cannot see; the last is
//                           an external assembly type, unknowable by construction.
//   implicit.types          types whose base list names at least one interface declared in the
//                           index, i.e. the exposure of any implicit rule
//   implicit.locallyResolved  members of those types that an IN-FILE interface declares — the
//                           only implicit edges derivable without cross-file resolution
//   implicit.crossFileOnly  members matched only by an interface declared in ANOTHER drawn file
//   implicit.noEdge         members of interface-implementing types that no indexed interface
//                           declares (unrelated members — the case where publishing an edge
//                           would be fabrication)
//
// The index is built from the DRAWN FILES ONLY (the lane's own evidence base), so "not in the
// draw" is reported as a scope limit rather than as an absence in the language.
//
// Run: bun script/m60/c923-interface-member-census.ts [--emit]
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const WASM_DIR = path.join(ROOT, "wasm")
const OUT = path.join(ROOT, "validation", "m60", "results", "c923-interface-members.json")
const CORPUS_ROOT = "$HOME/fixtures/repositories"

const EMIT = process.argv.includes("--emit")
/** Full-extent mode: every .cs file in both pinned corpora, not just the pinned draw. */
const FULL = process.argv.includes("--full")
const ALL_FILES = 1_000_000
const SAMPLE_CAP = 12

const TYPE_DECLS = new Set(["class_declaration", "struct_declaration", "interface_declaration", "record_declaration"])
/** Member declarations that can carry an explicit interface specifier. */
const MEMBER_DECLS = new Set(["method_declaration", "property_declaration", "event_declaration", "event_field_declaration", "indexer_declaration"])
/**
 * Member declarations that DECLARE a member name an implementation can satisfy.
 * `indexer_declaration` is included (as the name `this`, the spelling this lane already uses for
 * an indexer symbol): the 3 explicit indexer members in the full extent are real members of the
 * contract, and leaving them out of the CONTRACT side would hide them from the implicit rule.
 */
const SATISFIABLE_DECLS = new Set(["method_declaration", "property_declaration", "event_declaration", "event_field_declaration", "indexer_declaration"])
const BODY = "declaration_list"

export interface MemberFact {
  kind: string
  name: string
  explicitIface: string | null
  line: number
  text: string
}
export interface TypeFact {
  kind: string
  name: string
  bases: string[]
  members: MemberFact[]
}

// ------------------------------------------------------------------ pure helpers (self-tested)

/**
 * The type name a base-list entry resolves by: the leaf after the last dot, with any generic
 * argument list removed. `System.Collections.Generic.IList<Foo>` → `IList`. No regex: a linear
 * scan, so a `<` in a nested generic cannot make the cut drift.
 */
export function baseLeafName(raw: string): string {
  let depth = 0
  let end = raw.length
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i)
    if (c === 60) { // '<'
      if (depth === 0) end = i
      depth++
    } else if (c === 62) { // '>'
      if (depth > 0) depth--
    }
  }
  const head = raw.slice(0, end)
  const dot = head.lastIndexOf(".")
  const leaf = dot >= 0 ? head.slice(dot + 1) : head
  return leaf.trim()
}

/** Where the interface named by an explicit specifier is declared, relative to the draw. */
export type OwnerResolution = "in-file" | "cross-file" | "external"
export function classifyExplicitOwner(
  ifaceName: string,
  inFileInterfaces: ReadonlySet<string>,
  drawInterfaces: ReadonlySet<string>,
): OwnerResolution {
  if (inFileInterfaces.has(ifaceName)) return "in-file"
  if (drawInterfaces.has(ifaceName)) return "cross-file"
  return "external"
}

/**
 * The interface name written by an `explicit_interface_specifier` (`IFoo.` → `IFoo`).
 * The trailing `.` is dropped by a linear scan, not a pattern, so a nested qualifier or a
 * generic argument list cannot make the cut drift.
 */
export function explicitInterfaceName(specText: string): string {
  let end = specText.length
  while (end > 0) {
    const c = specText.charCodeAt(end - 1)
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 46) end--
    else break
  }
  return baseLeafName(specText.slice(0, end))
}

// ------------------------------------------------------------------ tree walking

function nameOf(node: any): string | null {
  const n = node.childForFieldName?.("name")
  if (n && typeof n.text === "string") return n.text
  // An indexer has no `name` field at all: the lane publishes it as `this`.
  if (node.type === "indexer_declaration") return "this"
  // A field-like event writes its name on a `variable_declarator`, not on a `name` field — the
  // shape that kept events out of this census's implicit buckets entirely.
  if (node.type === "event_field_declaration" || node.type === "field_declaration") {
    const vd = node.namedChildren?.find?.((c: any) => c.type === "variable_declaration")
    const decl = vd?.namedChildren?.find?.((c: any) => c.type === "variable_declarator")
    const id = decl?.namedChildren?.find?.((c: any) => c.type === "identifier")
    if (id && typeof id.text === "string") return id.text
  }
  const id = node.namedChildren?.find?.((c: any) => c.type === "identifier" || c.type === "generic_name")
  return id && typeof id.text === "string" ? id.text : null
}

function collectTypeFacts(root: any, out: TypeFact[]): void {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (TYPE_DECLS.has(node.type)) {
      const name = nameOf(node)
      if (name) {
        const bases: string[] = []
        const baseList = node.namedChildren?.find?.((c: any) => c.type === "base_list")
        if (baseList) {
          for (const b of baseList.namedChildren ?? []) {
            if (b.type === "argument_list") continue
            const tn = b.type === "primary_constructor_base_type"
              ? (b.namedChildren ?? []).find((c: any) => c.type === "identifier" || c.type === "generic_name")
              : b
            if (tn && typeof tn.text === "string") bases.push(tn.text.replace(/\s+/g, " "))
          }
        }
        const members: MemberFact[] = []
        // Descend through every intermediate node except nested type declarations: a member
        // inside `#if`/`#region` sits under a `preproc_if`, and reading only `declaration_list`'s
        // direct children under-counted the corpus by 4 explicit members (the same defect the
        // tree-derived side of script/m60/verify-c923-interface-members.ts carried).
        const memberNodes: any[] = []
        const inner: any[] = (node.namedChildren ?? []).slice()
        while (inner.length > 0) {
          const m = inner.pop()!
          if (m !== node && TYPE_DECLS.has(m.type)) continue
          if (MEMBER_DECLS.has(m.type)) { memberNodes.push(m); continue }
          for (const c of m.namedChildren ?? []) inner.push(c)
        }
        for (const m of memberNodes) {
          if (!MEMBER_DECLS.has(m.type)) continue
          const explicitNode = (m.namedChildren ?? []).find((c: any) => c.type === "explicit_interface_specifier")
          const n = nameOf(m)
          // A member with NO name cannot be matched against a contract, so it is not a candidate
          // at all (`§anon§` used to inflate the explicit bucket with declarations that could
          // never be compared to anything).
          if (!n) continue
          members.push({
            kind: m.type.replace(/_declaration$/, "").replace(/^event_field$/, "event"),
            // An indexer has no referenceable name; it is carried as "this" for the histogram.
            name: n,
            explicitIface: explicitNode ? explicitInterfaceName(explicitNode.text) : null,
            line: m.startPosition?.row != null ? m.startPosition.row + 1 : 0,
            text: String(m.text ?? "").split("\n")[0].slice(0, 120),
          })
        }
        out.push({ kind: node.type, name, bases, members })
      }
    }
    for (const c of node.namedChildren ?? []) stack.push(c)
  }
}

/** The member names an interface declares (the set an implementation must match). */
function interfaceMemberNames(root: any, into: Map<string, Set<string>>): void {
  const stack: any[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === "interface_declaration") {
      const name = nameOf(node)
      if (name) {
        let set = into.get(name)
        if (!set) { set = new Set<string>(); into.set(name, set) }
        // Same descendant walk as the implementing side (see collectTypeFacts): an interface's
        // members can sit inside a `#if` block too.
        const inner: any[] = (node.namedChildren ?? []).slice()
        while (inner.length > 0) {
          const m = inner.pop()!
          if (m !== node && TYPE_DECLS.has(m.type)) continue
          if (SATISFIABLE_DECLS.has(m.type)) {
            const n = nameOf(m)
            if (n) set.add(n)
            continue
          }
          for (const c of m.namedChildren ?? []) inner.push(c)
        }
      }
    }
    for (const c of node.namedChildren ?? []) stack.push(c)
  }
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const { LANGS, LANG_REPOS, SECOND_CORPUS } = await import("../m14/differential.ts")
  const { filesFor } = await import("./target-spelling-census.ts")

  const lang = "csharp"
  const cfg = LANGS[lang]
  const language = await Language.load(fs.readFileSync(path.join(WASM_DIR, cfg.wasm)))
  const parser = new ParserClass()
  parser.setLanguage(language)

  const draws: Array<{ repo: string; files: string[] }> = []
  for (const [repo, cap] of [[LANG_REPOS[lang], 40], [SECOND_CORPUS[lang], 24]] as Array<[string, number]>) {
    if (!repo) continue
    const files = filesFor(lang, repo, cap)
    if (files.length) draws.push({ repo, files })
  }

  const artifact: any = { at: null, lane: lang, wasm: cfg.wasm, draws: {}, combined: null, selfTests: null }
  const fullDraws: Array<{ repo: string; files: string[] }> = []
  if (FULL) {
    for (const repo of [LANG_REPOS[lang], SECOND_CORPUS[lang]]) {
      if (!repo) continue
      const files = filesFor(lang, repo, ALL_FILES)
      // Disclosed, not hidden: the whole corpus tree, every .cs file it contains.
      if (files.length) fullDraws.push({ repo, files })
    }
  }

  // Draw-level index of every interface the drawn TEXT declares (per name, merged across files).
  const drawInterfaces = new Set<string>()
  const corpusIfaceMembers = new Map<string, Set<string>>()
  const perFile = new Map<string, { ifaces: Map<string, Set<string>>; types: TypeFact[] }>()
  for (const draw of draws.concat(fullDraws)) {
    for (const file of draw.files) {
      let src: string
      try { src = fs.readFileSync(file, "utf8") } catch { continue }
      const tree = parser.parse(src)
      if (!tree?.rootNode) continue
      const ifaces = new Map<string, Set<string>>()
      interfaceMemberNames(tree.rootNode, ifaces)
      const types: TypeFact[] = []
      collectTypeFacts(tree.rootNode, types)
      perFile.set(file, { ifaces, types })
      for (const [name, members] of ifaces) {
        drawInterfaces.add(name)
        // The corpus-wide MEMBER SET, not just the name: the cross-file bucket below asks
        // whether an interface declared in ANOTHER file declares a member, which a name set
        // cannot answer. (Measured: reading it off the file's own map reported crossFileOnly=0
        // for a reason that had nothing to do with the corpus.)
        let merged = corpusIfaceMembers.get(name)
        if (!merged) { merged = new Set<string>(); corpusIfaceMembers.set(name, merged) }
        for (const m of members) merged.add(m)
      }
    }
  }

  const measure = (runDraws: Array<{ repo: string; files: string[] }>) => {
  const out: any = { draws: {} }
  const totals: any = {
    files: 0,
    explicit: { count: 0, parents: {}, byKind: {}, resolution: { "in-file": 0, "cross-file": 0, external: 0 }, inInterfaceDeclarations: 0 },
    implicit: {
      types: 0, locallyResolved: 0, crossFileOnly: 0, noEdge: 0, byKind: {},
      typesWithAnyBase: 0, typesWithLocalContract: 0, typesWithCrossContractOnly: 0,
      typesExternalOnly: 0, externalContracts: 0,
    },
    samples: { explicit: [] as any[], locallyResolved: [] as any[], crossFileOnly: [] as any[] },
  }

  for (const draw of runDraws) {
    const per: any = {
      repo: draw.repo, files: 0,
      explicit: { count: 0, parents: {}, byKind: {}, resolution: { "in-file": 0, "cross-file": 0, external: 0 }, inInterfaceDeclarations: 0 },
      implicit: {
        types: 0, locallyResolved: 0, crossFileOnly: 0, noEdge: 0, byKind: {},
        typesWithAnyBase: 0, typesWithLocalContract: 0, typesWithCrossContractOnly: 0,
        typesExternalOnly: 0, externalContracts: 0,
      },
      samples: { explicit: [] as any[], locallyResolved: [] as any[], crossFileOnly: [] as any[] },
    }
    for (const file of draw.files) {
      const facts = perFile.get(file)
      if (!facts) continue
      per.files++
      const inFileIfaces = new Set(facts.ifaces.keys())
      for (const type of facts.types) {
        // An interface declaration is not an implementation; its members are the CONTRACT. An
        // explicit member written INSIDE an interface is counted separately and NOT as an
        // implementation edge (13 such declarations exist in the full extent; counting them made
        // this census disagree with both the tree-derived side and the oracle).
        if (type.kind === "interface_declaration") {
          for (const m of type.members) if (m.explicitIface) per.explicit.inInterfaceDeclarations++
          continue
        }
        const baseNames = type.bases.map(baseLeafName)
        // Three disjoint kinds of base-list entry, and the boundary decision turns on the
        // difference: declared in THIS file (member set known per-file), declared elsewhere in
        // the corpus (member set known only with the corpus index), or not in the corpus text at
        // all (an assembly type — unknowable at any scope, the honest external).
        const localIfaces = baseNames.filter((b) => inFileIfaces.has(b))
        const crossIfaces = baseNames.filter((b) => !inFileIfaces.has(b) && corpusIfaceMembers.has(b))
        const externalIfaces = baseNames.filter((b) => !inFileIfaces.has(b) && !corpusIfaceMembers.has(b))
        const localNames = new Set<string>()
        for (const b of localIfaces) for (const n of facts.ifaces.get(b) ?? []) localNames.add(n)
        const crossNames = new Set<string>()
        for (const b of crossIfaces) for (const n of corpusIfaceMembers.get(b) ?? []) crossNames.add(n)
        // The SHIPPED rule's refusal, applied here too: a base CLASS that declares the member
        // already fills the interface slot, so that member is not a candidate for this type. The
        // census without this rule counted 8 such members in the full extent and made the
        // reconciliation read as a defect in the analyzer.
        const baseClassNames = new Set<string>()
        for (const b of baseNames) {
          const bt = facts.types.find((t) => t.name === b && t.kind !== "interface_declaration")
          for (const mem of bt?.members ?? []) baseClassNames.add(mem.name)
        }
        if (baseNames.length > 0) {
          per.implicit.typesWithAnyBase++
          if (localIfaces.length > 0) per.implicit.typesWithLocalContract++
          if (localIfaces.length === 0 && crossIfaces.length > 0) per.implicit.typesWithCrossContractOnly++
          if (localIfaces.length === 0 && crossIfaces.length === 0) per.implicit.typesExternalOnly++
          per.implicit.externalContracts += externalIfaces.length
        }

        for (const m of type.members) {
          if (m.explicitIface) {
            const res = classifyExplicitOwner(m.explicitIface, inFileIfaces, drawInterfaces)
            per.explicit.count++
            per.explicit.parents[m.kind] = (per.explicit.parents[m.kind] ?? 0) + 1
            per.explicit.byKind[m.kind] = (per.explicit.byKind[m.kind] ?? 0) + 1
            per.explicit.resolution[res]++
            totals.explicit.count++
            totals.explicit.parents[m.kind] = (totals.explicit.parents[m.kind] ?? 0) + 1
            totals.explicit.byKind[m.kind] = (totals.explicit.byKind[m.kind] ?? 0) + 1
            totals.explicit.resolution[res]++
            const sample = { repo: draw.repo, file: path.relative(path.join(CORPUS_ROOT, draw.repo), file), line: m.line, iface: m.explicitIface, resolution: res, text: m.text }
            if (per.samples.explicit.length < SAMPLE_CAP) per.samples.explicit.push(sample)
            if (totals.samples.explicit.length < SAMPLE_CAP) totals.samples.explicit.push(sample)
            continue
          }
          if (baseNames.length === 0) continue
          if (baseClassNames.has(m.name)) continue
          if (localNames.has(m.name)) {
            per.implicit.locallyResolved++
            per.implicit.byKind[m.kind] = (per.implicit.byKind[m.kind] ?? 0) + 1
            const sample = { repo: draw.repo, file: path.relative(path.join(CORPUS_ROOT, draw.repo), file), line: m.line, member: `${type.name}.${m.name}`, via: localIfaces.join(","), text: m.text }
            if (per.samples.locallyResolved.length < SAMPLE_CAP) per.samples.locallyResolved.push(sample)
            if (totals.samples.locallyResolved.length < SAMPLE_CAP) totals.samples.locallyResolved.push(sample)
          } else if (crossNames.has(m.name)) {
            per.implicit.crossFileOnly++
            per.implicit.byKind[m.kind] = (per.implicit.byKind[m.kind] ?? 0) + 1
            const sample = { repo: draw.repo, file: path.relative(path.join(CORPUS_ROOT, draw.repo), file), line: m.line, member: `${type.name}.${m.name}`, via: crossIfaces.join(","), text: m.text }
            if (per.samples.crossFileOnly.length < SAMPLE_CAP) per.samples.crossFileOnly.push(sample)
            if (totals.samples.crossFileOnly.length < SAMPLE_CAP) totals.samples.crossFileOnly.push(sample)
          } else {
            per.implicit.noEdge++
          }
        }
      }
    }
    // `types` = types with a contract the analyzer could resolve in some scope; the two
    // sub-counts name WHICH scope, and `typesExternalOnly` is the disclosed scope limit.
    per.implicit.types = per.implicit.typesWithLocalContract + per.implicit.typesWithCrossContractOnly
    totals.implicit.types += per.implicit.types
    totals.implicit.locallyResolved += per.implicit.locallyResolved
    totals.implicit.crossFileOnly += per.implicit.crossFileOnly
    totals.implicit.noEdge += per.implicit.noEdge
    totals.implicit.typesWithAnyBase += per.implicit.typesWithAnyBase
    totals.implicit.typesWithLocalContract += per.implicit.typesWithLocalContract
    totals.implicit.typesWithCrossContractOnly += per.implicit.typesWithCrossContractOnly
    totals.implicit.typesExternalOnly += per.implicit.typesExternalOnly
    totals.implicit.externalContracts += per.implicit.externalContracts
    totals.explicit.inInterfaceDeclarations += per.explicit.inInterfaceDeclarations
    for (const [k, v] of Object.entries(per.implicit.byKind)) totals.implicit.byKind[k] = (totals.implicit.byKind[k] ?? 0) + (v as number)
    out.draws[draw.repo] = per
  }
  totals.files = Object.values(out.draws).reduce((n: number, p: any) => n + p.files, 0)
  return { draws: out.draws, combined: totals }
  }

  const pinnedSection = measure(draws)
  artifact.draws = pinnedSection.draws
  artifact.combined = pinnedSection.combined
  if (FULL && fullDraws.length) {
    const section = measure(fullDraws)
    artifact.fullExtent = {
      draws: section.draws,
      combined: section.combined,
      filesPerRepo: fullDraws.map((d) => ({ repo: d.repo, files: d.files.length })),
    }
  }
  artifact.selfTests = selfTests()
  artifact.at = new Date().toISOString()

  for (const [repo, per] of Object.entries(artifact.draws) as any) {
    const p = per
    console.log(`\n=== ${repo}: ${p.files} files`)
    console.log(`  explicit  ${p.explicit.count}  byKind=${JSON.stringify(p.explicit.byKind)}  resolution=${JSON.stringify(p.explicit.resolution)}`)
    console.log(`  implicit  types=${p.implicit.types}  locallyResolved=${p.implicit.locallyResolved}  crossFileOnly=${p.implicit.crossFileOnly}  noEdge=${p.implicit.noEdge}  externalOnlyTypes=${p.implicit.typesExternalOnly}`)
  }
  const c = artifact.combined
  console.log(`\n=== combined: ${c.files} files`)
  console.log(`  explicit  ${c.explicit.count}  byKind=${JSON.stringify(c.explicit.byKind)}  resolution=${JSON.stringify(c.explicit.resolution)}`)
  console.log(`  implicit  types=${c.implicit.types}  locallyResolved=${c.implicit.locallyResolved}  crossFileOnly=${c.implicit.crossFileOnly}  noEdge=${c.implicit.noEdge}  byKind=${JSON.stringify(c.implicit.byKind)}`)
  console.log(`            typesWithAnyBase=${c.implicit.typesWithAnyBase} localContract=${c.implicit.typesWithLocalContract} crossOnly=${c.implicit.typesWithCrossContractOnly} externalOnly=${c.implicit.typesExternalOnly} externalContracts=${c.implicit.externalContracts}`)
  if (artifact.fullExtent) {
    const f = artifact.fullExtent.combined
    console.log(`\n=== FULL EXTENT (${f.files} files: ${artifact.fullExtent.filesPerRepo.map((r: any) => `${r.repo}=${r.files}`).join(", ")})`)
    console.log(`  explicit  ${f.explicit.count}  byKind=${JSON.stringify(f.explicit.byKind)}  parents=${JSON.stringify(f.explicit.parents)}  resolution=${JSON.stringify(f.explicit.resolution)}  (in-interface decls excluded: ${f.explicit.inInterfaceDeclarations})`)
    console.log(`  implicit  types=${f.implicit.types}  locallyResolved=${f.implicit.locallyResolved}  crossFileOnly=${f.implicit.crossFileOnly}  noEdge=${f.implicit.noEdge}  byKind=${JSON.stringify(f.implicit.byKind)}`)
    console.log(`            typesWithAnyBase=${f.implicit.typesWithAnyBase} localContract=${f.implicit.typesWithLocalContract} crossOnly=${f.implicit.typesWithCrossContractOnly} externalOnly=${f.implicit.typesExternalOnly} externalContracts=${f.implicit.externalContracts}`)
  }
  const st = artifact.selfTests
  console.log(`\nselfTests: ${st.passed}/${st.total} passed${st.failed.length ? " — FAILED: " + JSON.stringify(st.failed) : ""}`)

  if (EMIT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")
    console.log(`emitted ${path.relative(ROOT, OUT)}`)
  }
  if (st.failed.length) process.exitCode = 1
}

// ------------------------------------------------------------------ self-tests

function selfTests() {
  const failed: string[] = []
  let total = 0
  const eq = (name: string, got: any, want: any) => {
    total++
    if (JSON.stringify(got) !== JSON.stringify(want)) failed.push(`${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
  }
  eq("baseLeafName plain", baseLeafName("IThing"), "IThing")
  eq("baseLeafName qualified", baseLeafName("System.IDisposable"), "IDisposable")
  eq("baseLeafName generic", baseLeafName("IList<Foo>"), "IList")
  eq("baseLeafName nested generic", baseLeafName("A.B.IMap<K, List<V>>"), "IMap")
  eq("baseLeafName generic with dots inside", baseLeafName("IMap<A.B.C>"), "IMap")
  eq("baseLeafName no generic but dot", baseLeafName("Ns.Outer.Inner"), "Inner")
  eq("explicitInterfaceName strips the trailing dot", explicitInterfaceName("IFoo."), "IFoo")
  eq("explicitInterfaceName qualified", explicitInterfaceName("A.B.IFoo."), "IFoo")
  eq("explicitInterfaceName generic", explicitInterfaceName("IFoo<T>."), "IFoo")
  eq("classify in-file", classifyExplicitOwner("A", new Set(["A"]), new Set(["A", "B"])), "in-file")
  eq("classify cross-file", classifyExplicitOwner("B", new Set(["A"]), new Set(["A", "B"])), "cross-file")
  eq("classify external", classifyExplicitOwner("C", new Set(["A"]), new Set(["A", "B"])), "external")
  return { total, passed: total - failed.length, failed }
}

if (import.meta.main) await main()
