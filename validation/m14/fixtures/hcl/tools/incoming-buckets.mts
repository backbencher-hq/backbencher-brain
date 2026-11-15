/**
 * INCOMING BUCKETS — hcl's residual, bucketed by NAMED CONSTRUCT, and the price of the address fix.
 *
 * ## Why this file exists
 *
 * `incoming-gate.ts` prints the residual by TYPE and a 25-name worklist per type. `references 2135
 * unresolved` is a type, not a CONSTRUCT: the lane's rule is that every unresolved edge must be
 * attributed to a NAMED CAUSE with a measured count, and "references" restates the column. This
 * census walks THE GATE'S OWN POPULATION (its `BB_LIST_FILES` output — never a re-discovery), runs
 * THE GATE'S OWN RULE (`incoming-rule.ts`, imported, never copied) and reports:
 *
 *   1. the outcome counts, reconciled against the gate's TABLE 1 exactly;
 *   2. the unresolved edges bucketed by the CONSTRUCT the target names
 *      (`var.<name>` / `local.<name>` / `module.<name>` / `data.<type>.<name>` / `provider.<name>` /
 *      `<resource_type>.<name>` / relative module source / override target …), with counts;
 *   3. THE PRICE of the one fix the analyzer's own source suggests — publish the Terraform ADDRESS
 *      the analyzer already computes (`metadata.hclAddress`) as the declaration's `qualifiedName`,
 *      which the gate indexes as an "alias". For every unresolved reference that would become
 *      answerable, this prints whether the declaration the fix points at is
 *      IN THE EDGE'S OWN FILE (-> sameFileUnproven/intended, allowed), IN ANOTHER FILE
 *      (-> arbitraryTwin, the class this task forbids on pain of revert), or MORE THAN ONE
 *      (-> collRes, the tie-break class).
 *
 * ## Discipline
 *
 *   * The population is the gate's list. `BB_LIST_FILES=1 bun run script/m14/incoming-gate.ts hcl
 *     tf,hcl,tfvars,tofu 400 2> list.txt` produces it; this probe never discovers files itself.
 *   * The rule is imported. This probe does not reimplement `classifyEdge`.
 *   * `classifyIntent` IS re-stated (8 lines) because the gate does not export it; §"reconcile"
 *     proves the copy agrees with the gate's printed intent table.
 *   * The address index is built from the analyzer's OWN `metadata.hclAddress` / `metadata.hclBlockType`,
 *     so "the fix would answer this" is read off the emitter, not guessed from the target's spelling.
 *
 * Usage:
 *   bun run validation/m14/fixtures/hcl/tools/incoming-buckets.mts <gate-list.txt> [--json out.json]
 */
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import * as wts from "web-tree-sitter"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { RealHclAnalyzer } from "../../../../../src/ast/real-hcl-analyzer"
import { classifyEdge, externalClaimOf, isContainsEdge } from "../../../../../script/m14/incoming-rule"

/**
 * THE DECLARATION ADDRESS INDEX NEEDS THE RAW ANALYZER, NOT `parseFile`.
 *
 * `pool-worker.ts`'s symbol normaliser (its `return { name, type, kind, qualifiedName, … }` block)
 * DROPS the analyzer's whole `metadata` object across the worker boundary — it carries only a narrow
 * allowlist (`isDeclaration`, license, docstringKind, …). So `metadata.hclAddress`, the Terraform
 * address this lane already computes at `real-hcl-analyzer.ts:398`, does not survive `parseFile`, and
 * a price model that reads it from there reads an EMPTY index for every block type. That is exactly
 * what the first revision of this probe did: it priced 6,650 edges and silently attributed all of
 * them to the `locals` branch (which falls back to `s.name`), while every `var.`/`module.`/`data.`
 * row read 0 — a confident zero from a table that could never match, the defect this programme has
 * now recorded three times. The raw analyzer is therefore run beside `parseFile`: `parseFile` for the
 * gate's own outcome columns, the analyzer for the addresses it emits before the boundary.
 */
const Parser = (wts as any).Parser ?? (wts as any).default?.Parser ?? (wts as any).default
const Language = (wts as any).Language ?? (wts as any).default?.Language ?? (wts as any).default
await Parser.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const hclParser = new Parser()
hclParser.setLanguage(await Language.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-hcl.wasm"))))
const rawAnalyzer = new RealHclAnalyzer()

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIST = process.argv[2]
if (!LIST) {
  console.error("usage: bun run …/incoming-buckets.mts <gate-list.txt> [--json out.json]")
  process.exit(2)
}
const JSON_OUT = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : ""

const files = readFileSync(LIST, "utf8")
  .split("\n")
  .filter((l) => l.startsWith("BB_LIST_FILES_FILE: "))
  .map((l) => l.slice("BB_LIST_FILES_FILE: ".length).trim())
if (files.length === 0) {
  console.error(`no files in ${LIST} — run the gate with BB_LIST_FILES=1 first`)
  process.exit(2)
}
const repoOf = (f: string) => path.join(CR, path.relative(CR, f).split(path.sep)[0])

// ── the gate's key space, its exact semantics (incoming-gate.ts:1000-1035) ──────────────────────
type Pos = { file: string; line: number }
const declPos = new Map<string, Pos[]>()
const pooledDecl = new Map<string, number>()
const pooledKinds = new Map<string, Set<string>>()
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()

/** The address index: the Terraform ADDRESS each declaration would publish under the fix. */
type DeclAddr = { repo: string; file: string; line: number; address: string; construct: string; name: string; qname: string }
const addressIndex = new Map<string, DeclAddr[]>() // key = `${repo}\u0000${address}`
const relOf = (f: string) => path.relative(repoOf(f), f)

type Edge = { label: string; tgt: string; claim: any; repo: string; srcFile: string; line: number | null }

const countKey = (
  m: Map<string, Map<string, number>>,
  k: Map<string, Map<string, Set<string>>>,
  repo: string,
  key: string,
  kind: string,
  file: string,
  line: number | null,
) => {
  const pos = { file, line: line ?? -1 }
  const at = declPos.get(key)
  if (!at) declPos.set(key, [pos])
  else if (!at.some((d) => d.file === file && d.line === pos.line)) at.push(pos)
  pooledDecl.set(key, (pooledDecl.get(key) ?? 0) + 1)
  let ps = pooledKinds.get(key)
  if (!ps) pooledKinds.set(key, (ps = new Set()))
  ps.add(kind)
  let pm = m.get(repo)
  if (!pm) m.set(repo, (pm = new Map()))
  pm.set(key, (pm.get(key) ?? 0) + 1)
  let pk = k.get(repo)
  if (!pk) k.set(repo, (pk = new Map()))
  let ks = pk.get(key)
  if (!ks) pk.set(key, (ks = new Set()))
  ks.add(kind)
}

/** The Terraform address a declaration advertises, from the analyzer's OWN metadata. */
const addressOfSymbol = (s: any): { address: string; construct: string } | null => {
  const md = s?.metadata ?? {}
  const bt = String(md.hclBlockType ?? "")
  const addr = String(md.hclAddress ?? s?.name ?? "")
  if (!bt || !addr) return null
  switch (bt) {
    case "resource": return { address: addr, construct: "resource-address" }
    case "data": return { address: `data.${addr}`, construct: "data-address" }
    case "variable": return { address: `var.${addr}`, construct: "variable-address" }
    case "output": return { address: `output.${addr}`, construct: "output-address" }
    case "module": return { address: `module.${addr}`, construct: "module-address" }
    case "provider": return { address: `provider.${addr}`, construct: "provider-address" }
    case "locals": return null // the BLOCK is not addressable; its ATTRIBUTES are `local.<key>`
    case "target": return { address: addr, construct: "docker-bake-target" }
    default: return null
  }
}
/** An attribute of a `locals` block is addressable as `local.<key>` — a DIFFERENT spelling from the
 *  `locals.<key>` the analyzer publishes today, which is why it is priced separately (§3). */
const localsAttributeOf = (s: any): { address: string; construct: string } | null => {
  if (String(s?.kind ?? "") !== "property") return null
  const scope = String(s?.scope ?? "")
  const owner = String(s?.ownerName ?? "")
  if (owner !== "locals" && !scope.split(".").includes("locals")) return null
  const key = String(s?.metadata?.hclAddress ?? s?.name ?? "")
  if (!key) return null
  return { address: `local.${key}`, construct: "locals-attribute-address" }
}

const pending: Edge[] = []
/** What the raw analyzer published, by construct — the price's DENOMINATOR, printed so an empty
 *  index cannot be read as "the fix reaches nothing". */
const addressCensusTotal = new Map<string, number>()
let parsed = 0
for (const f of files) {
  let r: any
  try {
    r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any)
  } catch {
    continue
  }
  if (!r) continue
  parsed++
  const repo = repoOf(f)
  // THE ADDRESS INDEX, from the RAW analyzer (see the header note on the worker boundary).
  const addressCensus = new Map<string, number>()
  try {
    const content = readFileSync(f, "utf8")
    const tree = hclParser.parse(content)
    const raw = rawAnalyzer.analyze(tree.rootNode, content, f)
    for (const s of raw.symbols) {
      for (const cand of [addressOfSymbol(s as any), localsAttributeOf(s as any)]) {
        if (!cand) continue
        const k = `${repo}\u0000${cand.address}`
        const list = addressIndex.get(k) ?? []
        list.push({ repo, file: f, line: s.range.startLine, address: cand.address, construct: cand.construct, name: s.name, qname: String(s.qualifiedName ?? "") })
        addressIndex.set(k, list)
        addressCensus.set(cand.construct, (addressCensus.get(cand.construct) ?? 0) + 1)
      }
    }
  } catch { /* a file that will not read holds no declarations */ }
  for (const [k, n] of addressCensus) addressCensusTotal.set(k, (addressCensusTotal.get(k) ?? 0) + n)


  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const kind = String(s?.kind ?? "")
    // THE GATE'S OWN FALLBACK CHAIN, copied deliberately: `parseFile` normalises a symbol's line
    // under one of these spellings and the gate accepts all of them (incoming-gate.ts:1002). Reading
    // only `range.startLine` made every declaration line `null`, so the intent copy read
    // `sameFileUnproven` where the gate reads `intended` — caught by §1b's reconciliation, which is
    // why that reconciliation exists.
    const line = Number(
      (s as any)?.range?.startLine ?? (s as any)?.range?.start_line ?? (s as any)?.line_start ??
      (s as any)?.lineStart ?? (s as any)?.startLine ?? (s as any)?.line ?? 0,
    ) || null
    const q = String(s?.qualifiedName ?? "")
    countKey(projectDecl, projectKinds, repo, name, kind, f, line)
    if (q.length > 0 && q !== name) countKey(projectDecl, projectKinds, repo, q, kind, f, line)
    // NO address index here: `parseFile` has already dropped the symbol `metadata` that carries
    // `hclBlockType`/`hclAddress`, so an index built from this loop can only ever hold the `locals`
    // fallback (which reads `s.name`) and reads a confident zero for every block address. The index
    // is built from the raw analyzer above instead.
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? rel?.relationshipType ?? "")
    if (!label) continue
    const tgt = String(rel?.target ?? rel?.to ?? "")
    if (!tgt) continue
    pending.push({
      label, tgt, claim: externalClaimOf(rel), repo,
      srcFile: f,
      line: Number((rel as any)?.line_number ?? (rel as any)?.lineNumber ?? 0) || null,
    })
  }
}

// ── classify, exactly as the gate does ──────────────────────────────────────────────────────────
const LINE_IS_TARGET_LINE = new Set(["contains", "exports"])
const classifyIntent = (tgt: string, src: string, line: number | null, label: string): string => {
  const decls = declPos.get(tgt)
  if (!decls || decls.length === 0) return "noDeclaration"
  if (!decls.some((d) => d.file === src)) return "arbitraryTwin"
  if (LINE_IS_TARGET_LINE.has(label) && line !== null && decls.some((d) => d.file === src && d.line === line)) return "intended"
  return "sameFileUnproven"
}

const outcome = new Map<string, Record<string, number>>()
const intent = new Map<string, Record<string, number>>()
const bump = (m: Map<string, Record<string, number>>, k: string, f: string) => {
  let row = m.get(k)
  if (!row) m.set(k, (row = {}))
  row[f] = (row[f] ?? 0) + 1
}
const unresolved: Edge[] = []
for (const e of pending) {
  const own = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)
  const pc = classifyEdge(projectDecl.get(e.repo) ?? new Map(), projectKinds.get(e.repo) ?? new Map(), e.tgt, e.claim, undefined, isContainsEdge(e.label), own)
  bump(outcome, e.label, pc.outcome)
  bump(intent, e.label, classifyIntent(e.tgt, e.srcFile, e.line, e.label))
  if (pc.outcome === "unresolved") unresolved.push(e)
}

// ── §1 reconcile against the gate ───────────────────────────────────────────────────────────────
const OUT_COLS = ["resolved", "ambDeclOnly", "ambBoth", "externalVerified", "externalUnverified", "unresolved", "bindingVerified", "bindingRefuted", "bindingUnverified", "causeDeclared", "causeRefuted"]
console.log(`PARSED ${parsed} of ${files.length} · EDGES ${pending.length}`)
console.log("§1 RECONCILE (this probe's outcome -> the gate's columns)")
console.log(`type          edges    resolved  collRes  amb(decl)  unresolved  extOK   ext?    extFAIL  causeOK`)
let t = { edges: 0, resolved: 0, collRes: 0, amb: 0, unresolved: 0, extOK: 0, extUnk: 0, extFAIL: 0, cause: 0 }
for (const [label, row] of [...outcome.entries()].sort()) {
  const edges = (["resolved", "ambDeclOnly", "ambBoth", "unresolved", "externalVerified", "externalUnverified", "externalRefuted", "bindingVerified", "bindingRefuted", "bindingUnverified", "causeDeclared", "causeRefuted"] as const).reduce((a, k) => a + (row[k] ?? 0), 0)
  const resolved = row.resolved ?? 0
  const amb = (row.ambDeclOnly ?? 0) + (row.ambBoth ?? 0)
  const un = row.unresolved ?? 0
  const ok = row.externalVerified ?? 0
  const unk = row.externalUnverified ?? 0
  const fail = row.externalRefuted ?? 0
  const cause = (row.causeDeclared ?? 0) + (row.causeRefuted ?? 0)
  t = { edges: t.edges + edges, resolved: t.resolved + resolved, collRes: t.collRes, amb: t.amb + amb, unresolved: t.unresolved + un, extOK: t.extOK + ok, extUnk: t.extUnk + unk, extFAIL: t.extFAIL + fail, cause: t.cause + cause }
  console.log(`${label.padEnd(13)} ${String(edges).padEnd(8)} ${String(resolved).padEnd(9)} ${String(resolved).padEnd(8)} ${String(amb).padEnd(10)} ${String(un).padEnd(11)} ${String(ok).padEnd(7)} ${String(unk).padEnd(7)} ${String(fail).padEnd(8)} ${cause}`)
}
console.log(`TOTAL         ${t.edges}     ${t.resolved}     ${t.amb}      ${t.unresolved}      ${t.extOK}      ${t.extUnk}      ${t.extFAIL}      ${t.cause}`)
console.log("  (collRes and the `collRes` column are printed by the gate itself; this probe prints the same")
console.log("   outcome names, so `resolved`/`amb`/`unresolved`/`extOK` must equal TABLE 1 to the edge.)")
console.log("\n§1b BINDING INTENT (re-stated 8-line predicate — must equal the gate's block)")
console.log(`type          edges    intended  sameFileUnproven arbitraryTwin            noDeclaration`)
let ti = { edges: 0, intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, noDeclaration: 0 }
for (const [label, row] of [...intent.entries()].sort()) {
  const e = Object.values(row).reduce((a, b) => a + b, 0)
  ti = { edges: ti.edges + e, intended: ti.intended + (row.intended ?? 0), sameFileUnproven: ti.sameFileUnproven + (row.sameFileUnproven ?? 0), arbitraryTwin: ti.arbitraryTwin + (row.arbitraryTwin ?? 0), noDeclaration: ti.noDeclaration + (row.noDeclaration ?? 0) }
  console.log(`${label.padEnd(13)} ${String(e).padEnd(8)} ${String(row.intended ?? 0).padEnd(9)} ${String(row.sameFileUnproven ?? 0).padEnd(17)} ${String(row.arbitraryTwin ?? 0).padEnd(24)} ${row.noDeclaration ?? 0}`)
}
console.log(`TOTAL         ${ti.edges}     ${ti.intended}     ${ti.sameFileUnproven}      ${ti.arbitraryTwin}      ${ti.noDeclaration}`)

// ── §2 the unresolved, bucketed by NAMED CONSTRUCT ──────────────────────────────────────────────
const CONSTRUCT = (e: Edge): string => {
  const segs = e.tgt.split(".")
  const root = segs[0]
  if (e.label === "imports") {
    if (/^\.\.?\//.test(e.tgt)) return "module-source: relative path (./ or ../)"
    if (/^(git::|https?:|ssh:|git@)/.test(e.tgt)) return "module-source: remote URL"
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/.test(e.tgt)) return "module-source: registry address (ns/name/provider)"
    return "module-source: other"
  }
  if (e.label === "overrides") {
    const addr = addressIndex.get(`${e.repo}\u0000${e.tgt}`)
    return addr && addr.length > 0 ? `override target: address IS declared (${addr.length})` : "override target: no declaration anywhere in the project"
  }
  switch (root) {
    case "var": return "variable address (var.<name>)"
    case "local": return "locals address (local.<name>)"
    case "module": return "module address (module.<name>[.<output>])"
    case "data": return "data source address (data.<type>.<name>)"
    case "provider": return "provider address (provider.<name>[.<alias>])"
    default: {
      // a 2+-segment path whose root is a resource TYPE (`aws_instance.web[.attr]`)
      const addr2 = addressIndex.get(`${e.repo}\u0000${segs.slice(0, 2).join(".")}`)
      if (addr2 && addr2.length > 0) return "resource address (<type>.<name>[.<attr>])"
      return `other root (${root})`
    }
  }
}
const buckets = new Map<string, { n: number; examples: Edge[] }>()
for (const e of unresolved) {
  const k = CONSTRUCT(e)
  const b = buckets.get(k) ?? { n: 0, examples: [] }
  b.n++
  if (b.examples.length < 4) b.examples.push(e)
  buckets.set(k, b)
}
console.log(`\n§2 UNRESOLVED ${unresolved.length}, BY NAMED CONSTRUCT (population: the gate's own list, ${files.length} file(s))`)
for (const [k, b] of [...buckets.entries()].sort((a, c) => c[1].n - a[1].n)) {
  console.log(`  ${String(b.n).padStart(5)}  ${k}`)
  for (const e of b.examples) console.log(`         e.g. ${relOf(e.srcFile)}:${e.line ?? "?"}  ${e.label} -> ${e.tgt}`)
}

// ── §3 THE PRICE OF THE ADDRESS FIX ─────────────────────────────────────────────────────────────
// For an unresolved reference, the fix answers it iff publishing `tgt` as a declaration alias makes
// the key exist. For `var.x`/`data.t.n`/`module.m`/`provider.p`/`<type>.<name>` the analyzer ALREADY
// computes the address, so the question is only WHERE that declaration is.
const price = { wouldAnswer: 0, sameFile: 0, crossFile: 0, ambiguous: 0, none: 0, byConstruct: new Map<string, { n: number; same: number; cross: number; amb: number }>() }
const worked: Array<{ e: Edge; addr: DeclAddr[] }> = []
for (const e of unresolved) {
  if (e.label !== "references") continue
  const k = `${e.repo}\u0000${e.tgt}`
  const addr = addressIndex.get(k) ?? []
  const c = CONSTRUCT(e)
  const row = price.byConstruct.get(c) ?? { n: 0, same: 0, cross: 0, amb: 0 }
  row.n++
  if (addr.length === 0) { price.none++; price.byConstruct.set(c, row); continue }
  price.wouldAnswer++
  const same = addr.some((d) => d.file === e.srcFile)
  if (addr.length > 1) { price.ambiguous++; row.amb++ }
  else if (same) { price.sameFile++; row.same++ }
  else { price.crossFile++; row.cross++ }
  price.byConstruct.set(c, row)
  if (worked.length < 400) worked.push({ e, addr })
}
console.log(`\n§3 PRICE OF THE ADDRESS-ALIAS FIX (publish metadata.hclAddress as the declaration's qualifiedName)`)
console.log(`  POPULATION: the gate's own list ${LIST} — ${files.length} file(s)`)
console.log(`  DECLARATION ADDRESSES THE RAW ANALYZER PUBLISHED (the price's denominator):`)
for (const [c, n] of [...addressCensusTotal.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(7)}  ${c}`)
console.log(`    ${String([...addressCensusTotal.values()].reduce((a, b) => a + b, 0)).padStart(7)}  TOTAL (distinct address keys: ${addressIndex.size})`)
console.log(`  unresolved references that WOULD become answerable : ${price.wouldAnswer} of ${unresolved.filter((e) => e.label === "references").length}`)
console.log(`    of those, declaration in the SAME FILE           : ${price.sameFile}   -> sameFileUnproven/intended (allowed)`)
console.log(`    of those, declaration in ANOTHER FILE            : ${price.crossFile}   -> arbitraryTwin (THE REVERT CLASS)`)
console.log(`    of those, MORE THAN ONE declaration for the addr : ${price.ambiguous}   -> collRes (the tie-break class)`)
console.log(`  unresolved references the fix does NOT reach       : ${price.none}`)
for (const [c, r] of [...price.byConstruct.entries()].sort((a, b) => b[1].n - a[1].n)) {
  if (r.n === 0) continue
  console.log(`    ${String(r.n).padStart(5)} ${c.padEnd(52)} same ${r.same} · cross ${r.cross} · amb ${r.amb}`)
}

// ── §4 THE RESOLVED REFERENCE EDGES — the population a hand-read must be drawn from ────────────
// "Sample from the edges your fix resolves, not the easy ones." This prints them with the target,
// the site, and EVERY declaration that answers the target (file:line), so the reader can open the
// source and judge whether the binding is the one the code means.
const resolvedRefs: Array<{ e: Edge; decls: Pos[] }> = []
for (const e of pending) {
  if (e.label !== "references") continue
  const own = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)
  const pc = classifyEdge(projectDecl.get(e.repo) ?? new Map(), projectKinds.get(e.repo) ?? new Map(), e.tgt, e.claim, undefined, false, own)
  if (pc.outcome !== "resolved") continue
  resolvedRefs.push({ e, decls: declPos.get(e.tgt) ?? [] })
}
console.log(`\n§4 RESOLVED \`references\` EDGES — ${resolvedRefs.length} (a hand-read is drawn from THESE)`)
for (const { e, decls } of resolvedRefs.slice(0, 40)) {
  const same = decls.some((d) => d.file === e.srcFile)
  console.log(`  ${relOf(e.srcFile)}:${e.line ?? "?"} -> ${e.tgt}   [${same ? "sameFile" : "crossFile"}]  decl: ${decls.map((d) => `${relOf(d.file)}:${d.line}`).join(" | ")}`)
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    population: { parsed, files: files.length, edges: pending.length },
    outcome: Object.fromEntries(outcome), intent: Object.fromEntries(intent),
    unresolvedBuckets: Object.fromEntries([...buckets.entries()].map(([k, v]) => [k, v.n])),
    price: { ...price, byConstruct: Object.fromEntries(price.byConstruct) },
    addressCensus: Object.fromEntries(addressCensusTotal),
    resolvedReferences: resolvedRefs.map(({ e, decls }) => ({
      file: relOf(e.srcFile), line: e.line, target: e.tgt, construct: CONSTRUCT(e),
      sameFile: decls.some((d) => d.file === e.srcFile),
      declarations: decls.map((d) => ({ file: relOf(d.file), line: d.line })),
    })),
    worked: worked.slice(0, 40).map(({ e, addr }) => ({
      file: relOf(e.srcFile), line: e.line, target: e.tgt, construct: CONSTRUCT(e),
      declarations: addr.map((d) => ({ file: relOf(d.file), line: d.line, name: d.name, qname: d.qname, construct: d.construct })),
    })),
  }, null, 2))
  console.log(`\nwrote ${JSON_OUT}`)
}
