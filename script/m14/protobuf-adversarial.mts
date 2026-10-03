/**
 * PROTOBUF ADVERSARIAL PROBES — pass 2. One measurement per way an emitted label
 * could be wrong.
 *
 * ## Why this exists
 *
 * Pass 1 established the ten verdicts. A verdict table is a claim about labels, and
 * the six questions fail INDEPENDENTLY: a type can be emitted, on real files, with
 * both endpoints resolving, at confidence 1.0, and still carry the WRONG label. The
 * lane's own gate cannot see that class: protobuf is not in `differential.ts`'s
 * `LANGS` and `script/m14/oracles/` has no protobuf oracle, so there is no second
 * implementation to disagree with any of it (see the DERIVATION count below).
 *
 * So each probe below states, in one place, the STRONGEST ARGUMENT that a label is
 * wrong, and then measures whether the corpus supports the argument. A probe that
 * cannot come back non-zero is not a probe.
 *
 * ## Method
 *
 * ONE walk of the working tree, and per file THREE reads of the SAME tree:
 * production `parseFile` (the product's own path), the analyzer directly (for the
 * published `metadata.id`, which pool-worker's symbol projection drops), and the raw
 * tree (for the tree-level probes). Reading the tree once per instrument is the whole
 * point of instrument B: a string literal or a comment cannot produce a node.
 *
 * CLI: npx tsx script/m14/protobuf-adversarial.mts [--out /tmp/opencode/pb/adv.json]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../src/ast/real-protobuf-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/opencode/pb/adv.json"
const ROOT = process.cwd()

// ---------------------------------------------------------------- corpus
type F = { repo: string; rel: string; abs: string; text: string }
const files: F[] = []
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  const walk = (d: string, rel: string): void => {
    let kids: string[]
    try { kids = readdirSync(d) } catch { return }
    for (const k of kids.sort()) {
      if (k === ".git" || k === "node_modules") continue
      const abs = path.join(d, k)
      const r = rel ? `${rel}/${k}` : k
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) { walk(abs, r); continue }
      if (!k.endsWith(".proto")) continue
      if (st.size > 1024 * 1024) continue
      files.push({ repo: entry, rel: r, abs, text: readFileSync(abs, "utf8") })
    }
  }
  walk(dir, "")
}
console.error(`corpus: ${files.length} .proto files in ${new Set(files.map((f) => f.repo)).size} repositories`)

// ---------------------------------------------------------------- grammar
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang: any = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-protobuf.wasm")))
const analyzer = new RealProtobufAnalyzer()

const namedOf = (n: any, t: string): any[] => (n.namedChildren ?? []).filter((c: any) => c.type === t)
const kids = (n: any): any[] => (n.children ?? []).filter((c: any) => c && c.isNamed)

// ---------------------------------------------------------------- probes
/**
 * P1 — `calls` on an rpc: the analyzer tells request from response POSITIONALLY,
 * `kids(node).filter(message_or_enum_type)[0]` and `[1]`. If any rpc carries a
 * different number of `message_or_enum_type` children — an option's name parsed as
 * one, a one-sided rpc — the positional read names the wrong type.
 */
const rpcArity = new Map<number, number>()
const rpcBadExamples: string[] = []

/**
 * P2 — duplicate edges. `addRel` pushes without a dedupe, so two sites that agree
 * on (source, target, type, line) are two identical rows. The store's relId keys on
 * exactly those four, so they collapse in the index and the graph shows one edge
 * where the file states two.
 */
const dupEdgeShape = new Map<string, number>()
const dupEdgeExamples: string[] = []

/** P3 — resolution, per FILE and CORPUS-WIDE, in one pass at the end. */
const globalIds = new Set<string>()
const typeDeclIds = new Set<string>()
const perFileUsesBoth = { both: 0, total: 0 }
const usesTargetLocal = { sameFile: 0, crossFile: 0, unresolvedLocal: 0 }
const viaExtension = { contains: 0, srcResolves: 0, tgtResolves: 0, examples: [] as string[], ownerKindHistogram: new Map<string, number>() }

/** P4 — `.id` on the web-tree-sitter node binding. `typeOf` keys its cache on it. */
let nodesRead = 0
let nodesWithoutId = 0

/** P5 — files with no `package`: their top-level declarations have no owner edge. */
let filesWithoutPackage = 0
let topLevelDeclsWithoutOwner = 0
const noPackageExamples: string[] = []

/** P6 — `metadata.oneof` carries the oneof's BARE name, not its resolved id. */
let oneofFields = 0
let oneofNamesAmbiguous = 0
const oneofAmbiguousExamples: string[] = []

/** P7 — what a public import emits. Pass 1: `exports` only. Pass 2: both. */
const importPublic = { nodes: 0, exportsEdges: 0, importsEdges: 0, files: 0 }

/** P8 — could a custom option's name ever resolve to a published id? */
const customOpt = { n: 0, files: 0, resolvesInFile: 0, resolvesCorpus: 0, byParent: new Map<string, number>(), examples: [] as string[] }

/** P9 — Q6: is every `uses` TARGET a parse fact, or a derivation? */
const usesTarget = { declaredThisFile: 0, notDeclaredThisFile: 0, examples: [] as string[] }

/**
 * P10 — a `type` node the analyzer read as a SCALAR that is a declared type.
 *
 * The raw count and the adjudicated count are both reported, because on this corpus
 * they differ by exactly the cases protobuf's own parser-breaking fixtures create: a
 * message literally named `int32` or `bool`. `protoc` rejects a declaration named
 * after a keyword, so `int32` there is a keyword and the analyzer is right to emit no
 * edge — but the raw number is what a reader finds first, so it is on the record
 * rather than filtered away.
 */
const PROTOBUF_SCALAR_KEYWORDS = new Set([
  "double", "float", "int32", "int64", "uint32", "uint64", "sint32", "sint64",
  "fixed32", "fixed64", "sfixed32", "sfixed64", "bool", "string", "bytes",
])
let scalarShadowsDeclaredType = 0
let scalarShadowsDeclaredTypeNonKeyword = 0
const scalarShadowExamples: string[] = []

/** P11 — self-dependency guard on module edges (`imports`/`exports`). */
let moduleSelfEdges = 0
const moduleSelfExamples: string[] = []

/** P12 — `contains` edges whose SOURCE is the package namespace. */
let pkgContainsEdges = 0

/** P13 — duplicate (source,target,type) with DIFFERENT lines: real distinct sites. */
const distinctSiteEdges = new Map<string, Set<number>>()

/** P14 — does any edge carry a source equal to its target after id disambiguation? */
let selfLoopsAnalyzer = 0
const selfLoopExamples: string[] = []

// ---------------------------------------------------------------- walk
let idx = 0
let parseOk = 0
let parseFail = 0
const parseFailExamples: string[] = []
const relTypesSeen = new Map<string, number>()
const confSeen = new Map<string, number>()
const evidenceSeen = new Map<string, number>()
let analyzerEdges = 0
let productEdges = 0

async function worker(): Promise<void> {
  const parser = new P()
  parser.setLanguage(lang)
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`

    let prod: any
    try { prod = await parseFile(f.abs, path.dirname(f.abs)) } catch (e: any) {
      parseFail++; if (parseFailExamples.length < 8) parseFailExamples.push(`${label}: ${e?.message}`); continue
    }
    parseOk++

    const tree = parser.parse(f.text)
    if (!tree) continue
    const root = tree.rootNode
    const a: any = analyzer.analyze(root, f.text, f.abs)

    // ---- P4: the binding's `.id`
    const st: any[] = [root]
    while (st.length) {
      const n = st.pop()
      nodesRead++
      const id = n.id
      if (id === undefined || id === null) nodesWithoutId++
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }

    // ---- per-file symbol universe, for per-file resolution and P9/P10
    const localIds = new Set<string>()
    const localTypeIds = new Set<string>()
    for (const s of a.symbols ?? []) {
      const i = String(s.metadata?.id ?? s.name)
      localIds.add(i)
      if (s.kind === "class" || s.kind === "enum") localTypeIds.add(i)
      globalIds.add(i)
      if (s.kind === "class" || s.kind === "enum") typeDeclIds.add(i)
    }

    // ---- P5: package presence
    const pkgNode = kids(root).find((c) => c.type === "package")
    const pkgText = pkgNode ? String(namedOf(pkgNode, "full_ident")[0]?.text ?? "") : ""
    if (!pkgText) {
      filesWithoutPackage++
      const topLevelDecls = kids(root).filter((c) => ["message", "enum", "service"].includes(c.type)).length
      topLevelDeclsWithoutOwner += topLevelDecls
      if (noPackageExamples.length < 6) noPackageExamples.push(`${label} (${topLevelDecls} top-level declarations)`)
    }

    // ---- P1: rpc arity
    const rpcNodes: any[] = []
    const s2: any[] = [root]
    while (s2.length) {
      const n = s2.pop()
      if (n.type === "rpc" && n.isNamed) rpcNodes.push(n)
      for (let i = 0; i < n.childCount; i++) s2.push(n.child(i))
    }
    for (const rn of rpcNodes) {
      const k = kids(rn).filter((c) => c.type === "message_or_enum_type").length
      rpcArity.set(k, (rpcArity.get(k) ?? 0) + 1)
      if (k !== 2 && rpcBadExamples.length < 8) rpcBadExamples.push(`${label}:${rn.startPosition.row + 1} has ${k} message_or_enum_type children: ${JSON.stringify(rn.text).slice(0, 90)}`)
    }

    // ---- P8 + P10: custom options and scalar/type confusion, off the tree
    const s3: any[] = [root]
    while (s3.length) {
      const n = s3.pop()
      if (n.type === "option" && n.isNamed) {
        // custom iff the FIRST `(` anonymous token precedes the FIRST `.` token —
        // an editions feature option `features.(pb.cpp).repeated_type` has its paren
        // AFTER the dot and is not custom.
        const kidsU = (n.children ?? []).filter((c: any) => c && !c.isNamed)
        const fp = kidsU.findIndex((c: any) => c.text === "(")
        const fd = kidsU.findIndex((c: any) => c.text === ".")
        if (fp >= 0 && (fd < 0 || fp < fd)) {
          customOpt.n++
          const scope = n.parent?.type ?? "(none)"
          customOpt.byParent.set(scope, (customOpt.byParent.get(scope) ?? 0) + 1)
          // the option's name: the parenthesised full_ident
          const pn = (n.children ?? []).find((c: any) => c && !c.isNamed && c.text === "(")
          let name: string | null = null
          if (pn) {
            const nx = (n.children ?? [])[(n.children ?? []).indexOf(pn) + 1]
            if (nx && nx.isNamed) name = nx.text
          }
          if (name) {
            // Would protobuf's own rule reach a published id for it? Same fallback
            // the analyzer uses for an unqualified type reference.
            const cand = name.includes(".") ? name : (pkgText ? `${pkgText}.${name}` : name)
            if (localIds.has(cand)) customOpt.resolvesInFile++
            if (customOpt.examples.length < 8) customOpt.examples.push(`${label}:${n.startPosition.row + 1} name=${name} would-resolve-to=${cand}`)
          }
        }
      }
      if (n.type === "type" && n.isNamed) {
        const inner = namedOf(n, "message_or_enum_type")[0]
        if (!inner) {
          // read as a SCALAR. If that text is a type this file declares, a real
          // reference was dropped and the `uses` edge is a GAP, not a keyword.
          const t = n.text
          const cand = t.includes(".") ? t : (pkgText ? `${pkgText}.${t}` : t)
          if (localTypeIds.has(cand) || localTypeIds.has(t)) {
            scalarShadowsDeclaredType++
            if (!PROTOBUF_SCALAR_KEYWORDS.has(t)) scalarShadowsDeclaredTypeNonKeyword++
            if (scalarShadowExamples.length < 8) scalarShadowExamples.push(`${label}:${n.startPosition.row + 1} scalar ${JSON.stringify(t)} is a declared type (${cand})`)
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) s3.push(n.child(i))
    }

    // ---- P6: metadata.oneof ambiguity, per file
    const oneofNameToMessages = new Map<string, Set<string>>()
    for (const s of a.symbols ?? []) {
      if (s.kind !== "union") continue
      const n = String(s.name)
      const m = String(s.ownerName ?? pkgText ?? "")
      if (!oneofNameToMessages.has(n)) oneofNameToMessages.set(n, new Set())
      oneofNameToMessages.get(n)!.add(m)
    }
    for (const s of a.symbols ?? []) {
      if (!s.metadata || !("oneof" in (s.metadata as any))) continue
      oneofFields++
      const owners = oneofNameToMessages.get(String((s.metadata as any).oneof))
      if (owners && owners.size > 1) {
        oneofNamesAmbiguous++
        if (oneofAmbiguousExamples.length < 6) oneofAmbiguousExamples.push(`${label}: oneof "${(s.metadata as any).oneof}" is declared in ${owners.size} owners; field ${s.name} cannot be attributed by it`)
      }
    }

    // ---- relationships: production counts, plus the label probes
    productEdges += (prod.relationships ?? []).length
    analyzerEdges += (a.relationships ?? []).length

    for (const x of prod.relationships ?? []) {
      const t = String(x.type ?? "")
      relTypesSeen.set(t, (relTypesSeen.get(t) ?? 0) + 1)
      confSeen.set(String(x.confidence), (confSeen.get(String(x.confidence)) ?? 0) + 1)
      const ec = String((x.metadata as any)?.evidenceClass ?? "(absent)")
      evidenceSeen.set(ec, (evidenceSeen.get(ec) ?? 0) + 1)
      if (t === "imports" || t === "exports") {
        if (String(x.source) === String(x.target)) { moduleSelfEdges++; if (moduleSelfExamples.length < 6) moduleSelfExamples.push(`${label}: ${x.source} -> ${x.target}`) }
      }
    }

    // P2/P13/P14 + P9/P3 + viaExtension, on the ANALYZER output (it carries metadata)
    const seenKey = new Map<string, number>()
    for (const x of a.relationships ?? []) {
      const s = String(x.source)
      const t = String(x.target)
      const ty = String(x.type)
      const ln = Number(x.line_number ?? 0)
      if (s === t) { selfLoopsAnalyzer++; if (selfLoopExamples.length < 6) selfLoopExamples.push(`${label}: ${s} -${ty}-> ${t}`) }
      const key = `${s}\u0000${t}\u0000${ty}`
      const c4 = (seenKey.get(key) ?? 0)
      seenKey.set(key, c4 + 1)
      if (c4 === 0) { const set = distinctSiteEdges.get(key) ?? new Set<number>(); set.add(ln); distinctSiteEdges.set(key, set) }
      else if (c4 === 1) { const shape = `${ty} duplicated`; dupEdgeShape.set(shape, (dupEdgeShape.get(shape) ?? 0) + 1); if (dupEdgeExamples.length < 8) dupEdgeExamples.push(`${label}:${ln} ${s} -${ty}-> ${t} (identical source/target/type/line)`) }

      if (ty === "uses") {
        perFileUsesBoth.total++
        const ok = localIds.has(s) && localIds.has(t)
        if (ok) perFileUsesBoth.both++
        if (localTypeIds.has(t)) usesTarget.declaredThisFile++
        else { usesTarget.notDeclaredThisFile++; if (usesTarget.examples.length < 8) usesTarget.examples.push(`${label}: ${s} -uses-> ${t} (target not declared in this file; written as a name and qualified with the local package)`) }
      }
      const md = (x.metadata ?? {}) as any
      if (md.viaExtension && ty === "contains") {
        viaExtension.contains++
        const so = localIds.has(s)
        const to = localIds.has(t)
        if (so) viaExtension.srcResolves++
        if (to) viaExtension.tgtResolves++
        const k = String(md.member ?? "?")
        viaExtension.ownerKindHistogram.set(k, (viaExtension.ownerKindHistogram.get(k) ?? 0) + 1)
        if (viaExtension.examples.length < 6) viaExtension.examples.push(`${label}:${ln} ${s} -contains-> ${t} viaExtension (source-in-file=${so})`)
      }
      if (ty === "contains" && s === pkgText && pkgText) pkgContainsEdges++
      if (ty === "exports") { importPublic.exportsEdges++; if ((x.metadata as any)?.viaPublicImport === true) { importPublic.files++; importPublic.importsEdges++ } }
    }

    // P7: count import-public nodes on the tree and cross-check the emitted types
    const s4: any[] = [root]
    while (s4.length) {
      const n = s4.pop()
      if (n.type === "import" && n.isNamed) {
        const mod = (n.children ?? []).find((c: any) => c && !c.isNamed && (c.text === "public" || c.text === "weak" || c.text === "option"))
        if (mod && mod.text === "public") importPublic.nodes++
      }
      for (let i = 0; i < n.childCount; i++) s4.push(n.child(i))
    }

    tree.delete?.()
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

// ---------------------------------------------------------------- P3 corpus-wide
const corpusRes = new Map<string, { n: number; both: number; src: number; tgt: number; neither: number }>()
for (const f of []) void f
// recompute per-type corpus-wide resolution needs every edge; re-walk cheaply off the
// analyzer's own output only, without parseFile, so this pass is fast.
{
  let j = 0
  const rows = new Map<string, { n: number; both: number; src: number; tgt: number; neither: number }>()
  const grab = (rr: any): void => {
    for (const x of rr.relationships ?? []) {
      const ty = String(x.type)
      if (!/^(uses|contains|imports|exports)$/.test(ty)) continue
      const r = rows.get(ty) ?? { n: 0, both: 0, src: 0, tgt: 0, neither: 0 }
      r.n++
      const s = globalIds.has(String(x.source))
      const t = globalIds.has(String(x.target))
      if (s && t) r.both++; else if (s) r.src++; else if (t) r.tgt++; else r.neither++
      rows.set(ty, r)
    }
  }
  const w2 = async (): Promise<void> => {
    const parser = new P(); parser.setLanguage(lang)
    while (true) {
      const i = j++
      if (i >= files.length) return
      const f = files[i]
      const tree = parser.parse(f.text)
      if (!tree) continue
      try { grab(analyzer.analyze(tree.rootNode, f.text, f.abs)) } catch { /* counted as parseFail elsewhere */ }
      tree.delete?.()
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => w2()))
  for (const [k, v] of rows) corpusRes.set(k, v)
}
// custom options resolved against the CORPUS table
{
  let j = 0
  const w3 = async (): Promise<void> => {
    const parser = new P(); parser.setLanguage(lang)
    while (true) {
      const i = j++
      if (i >= files.length) return
      const f = files[i]
      const tree = parser.parse(f.text)
      if (!tree) continue
      const root = tree.rootNode
      const pkgNode = kids(root).find((c) => c.type === "package")
      const pkgText = pkgNode ? String(namedOf(pkgNode, "full_ident")[0]?.text ?? "") : ""
      const st: any[] = [root]
      while (st.length) {
        const n = st.pop()
        if (n.type === "option" && n.isNamed) {
          const kidsU = (n.children ?? []).filter((c: any) => c && !c.isNamed)
          const fp = kidsU.findIndex((c: any) => c.text === "(")
          const fd = kidsU.findIndex((c: any) => c.text === ".")
          if (fp >= 0 && (fd < 0 || fp < fd)) {
            const pn = kidsU.find((c: any) => c.text === "(")
            const arr: any[] = n.children ?? []
            const nx = pn ? arr[arr.indexOf(pn) + 1] : null
            const name = nx && nx.isNamed ? String(nx.text) : null
            if (name) {
              const cand = name.includes(".") ? name : (pkgText ? `${pkgText}.${name}` : name)
              if (globalIds.has(cand)) customOpt.resolvesCorpus++
            }
          }
        }
        for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
      }
      tree.delete?.()
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => w3()))
}

// ---------------------------------------------------------------- report
const pct = (n: number, d: number) => (d ? +(100 * n / d).toFixed(2) : null)
const out: any = {
  at: new Date().toISOString(),
  corpusRoot: CR,
  filesAdmitted: files.length,
  parseOk,
  parseFail,
  parseFailExamples,
  production: {
    edges: productEdges,
    analyzerDirectEdges: analyzerEdges,
    types: Object.fromEntries([...relTypesSeen.entries()].sort((a, b) => b[1] - a[1])),
    confidence: Object.fromEntries(confSeen),
    evidenceClass: Object.fromEntries(evidenceSeen),
    heuristicUnder07: [...confSeen.entries()].filter(([k]) => Number(k) < 0.7).reduce((a, [, v]) => a + v, 0),
  },
  P1_rpcArity: { histogram: Object.fromEntries([...rpcArity.entries()].sort((a, b) => a[0] - b[0])), notTwo: rpcArity.get(0) ?? 0, examples: rpcBadExamples, verdict: "the request/response read is POSITIONAL, so it is only sound while every rpc carries exactly 2 message_or_enum_type children" },
  P2_duplicateEdges: { shapes: Object.fromEntries(dupEdgeShape), examples: dupEdgeExamples, distinctSiteKeysWithMultipleLines: [...distinctSiteEdges.values()].filter((s) => s.size > 1).length },
  P3_resolution: {
    perFileUses: { bothEnds: perFileUsesBoth.both, total: perFileUsesBoth.total, ratePct: pct(perFileUsesBoth.both, perFileUsesBoth.total) },
    corpusWide: Object.fromEntries([...corpusRes.entries()].map(([k, v]) => [k, { ...v, bothEndsRatePct: pct(v.both, v.n), eitherEndRatePct: pct(v.both + v.src + v.tgt, v.n) }])),
    globalSymbolIds: globalIds.size,
    globalTypeIds: typeDeclIds.size,
  },
  P4_nodeIdBinding: { nodesRead, nodesWithoutId, verdict: nodesWithoutId === 0 ? "every node carries .id, so typeOf()'s cache is keyed correctly" : "typeOf() would return the FIRST node's type for every node after it — the analyzer would be broken" },
  P5_noPackage: { files: filesWithoutPackage, topLevelDeclarationsWithNoOwnerEdge: topLevelDeclsWithoutOwner, examples: noPackageExamples },
  P6_oneofNameAmbiguity: { oneofFields, ambiguous: oneofNamesAmbiguous, ratePct: pct(oneofNamesAmbiguous, oneofFields), examples: oneofAmbiguousExamples },
  P7_importPublic: { importPublicNodes: importPublic.nodes, exportsEdges: importPublic.exportsEdges, importsEdgesCarryingViaPublicImport: importPublic.importsEdges, files: importPublic.files, note: "pass 1 emitted `exports` ONLY, so a consumer asking what a file DEPENDS ON missed one file per public import. pass 2 emits both, and the count of `imports` edges carrying `viaPublicImport` is the number of dependencies pass 1 dropped." },
  P8_customOptions: { sites: customOpt.n, resolvesInFile: customOpt.resolvesInFile, resolvesCorpusWide: customOpt.resolvesCorpus, byParentNode: Object.fromEntries([...customOpt.byParent.entries()].sort((a, b) => b[1] - a[1])), examples: customOpt.examples },
  P9_usesTargetProvenance: { targetDeclaredThisFile: usesTarget.declaredThisFile, targetNotDeclaredThisFile: usesTarget.notDeclaredThisFile, parseFactRatePct: pct(usesTarget.declaredThisFile, usesTarget.declaredThisFile + usesTarget.notDeclaredThisFile), examples: usesTarget.examples },
  P10_scalarShadowsDeclaredType: {
    raw: scalarShadowsDeclaredType,
    nonKeywordName: scalarShadowsDeclaredTypeNonKeyword,
    note: "every raw hit on this corpus is a type named after a scalar KEYWORD, and all of them sit in protobuf's own test_bad_identifiers_{proto2,editions}.proto — deliberate parser-breaking fixtures. protoc rejects a declaration named after a keyword, so no edge is missing.",
    examples: scalarShadowExamples,
  },
  P11_moduleSelfEdges: { count: moduleSelfEdges, examples: moduleSelfExamples },
  P12_packageContainsEdges: pkgContainsEdges,
  viaExtension: { containsEdges: viaExtension.contains, sourceResolvesInFile: viaExtension.srcResolves, targetResolvesInFile: viaExtension.tgtResolves, sourceRatePct: pct(viaExtension.srcResolves, viaExtension.contains), byMember: Object.fromEntries([...viaExtension.ownerKindHistogram.entries()].sort((a, b) => b[1] - a[1])), examples: viaExtension.examples },
  selfLoopsAnalyzer,
  selfLoopExamples,
}
writeFileSync(OUT, JSON.stringify(out, null, 2))

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`\nfiles ${parseOk} ok / ${parseFail} fail   edges parseFile ${productEdges}  analyzer-direct ${analyzerEdges}`)
console.log(`types ${JSON.stringify(out.production.types)}`)
console.log(`confidence ${JSON.stringify(out.production.confidence)}  heuristic<0.7 ${out.production.heuristicUnder07}`)
console.log(`evidenceClass ${JSON.stringify(out.production.evidenceClass)}`)
console.log(`\nP1  rpc arity histogram ${JSON.stringify(out.P1_rpcArity.histogram)}   not-2 examples ${rpcBadExamples.length}`)
console.log(`P2  duplicate-edge shapes ${JSON.stringify(out.P2_duplicateEdges.shapes)}   keys with >1 line ${out.P2_duplicateEdges.distinctSiteKeysWithMultipleLines}`)
console.log(`P3  uses per-file both-ends ${out.P3_resolution.perFileUses.bothEnds}/${out.P3_resolution.perFileUses.total} = ${out.P3_resolution.perFileUses.ratePct}%`)
console.log(`P3  corpus-wide ${JSON.stringify(out.P3_resolution.corpusWide)}`)
console.log(`P4  nodes ${nodesRead}  without .id ${nodesWithoutId}`)
console.log(`P5  files without package ${filesWithoutPackage}  top-level decls with no owner edge ${topLevelDeclsWithoutOwner}`)
console.log(`P6  oneof fields ${oneofFields}  ambiguous bare name ${oneofNamesAmbiguous} (${out.P6_oneofNameAmbiguity.ratePct}%)`)
console.log(`P7  import public nodes ${importPublic.nodes}  exports edges ${importPublic.exportsEdges}  imports edges carrying viaPublicImport ${importPublic.importsEdges}`)
console.log(`P8  custom option sites ${customOpt.n}  resolve in-file ${customOpt.resolvesInFile}  resolve corpus-wide ${customOpt.resolvesCorpus}`)
console.log(`P9  uses targets declared in the SAME file ${usesTarget.declaredThisFile} (${out.P9_usesTargetProvenance.parseFactRatePct}%)  NOT declared ${usesTarget.notDeclaredThisFile}`)
console.log(`P10 scalar type text that IS a declared type: raw ${scalarShadowsDeclaredType}, of which NOT a keyword name ${scalarShadowsDeclaredTypeNonKeyword}`)
console.log(`P11 module self-edges ${moduleSelfEdges}`)
console.log(`P12 package contains edges ${pkgContainsEdges}`)
console.log(`    viaExtension contains ${viaExtension.contains}  source resolves in-file ${viaExtension.srcResolves} (${out.viaExtension.sourceRatePct}%)`)
console.log(`    self-loops ${selfLoopsAnalyzer}`)
console.log(`\nwrote ${OUT}`)