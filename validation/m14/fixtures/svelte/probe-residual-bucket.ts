/**
 * SVELTE LANE — RESIDUAL BUCKETER (read-only probe, never imported by the runner).
 *
 * WHY IT EXISTS. `script/m14/incoming-gate.ts` publishes the residual as COLUMNS and a
 * per-marker-set worklist, both SAMPLED (25 names per cap, 5 marker sets per type). A lane
 * asked to classify its own residual by NAMED CAUSE needs the edges themselves, and it must
 * NOT edit the gate to get them (`script/m14/**` is supervisor-owned). So the lane re-runs the
 * gate's OWN rule over the gate's OWN population and reproduces its classification:
 *
 *   * the same files (`BB_LIST_FILES` prints the discovery the gate will walk);
 *   * the same `parseFile(f, repoOf(f), { projectRoot: repoOf(f) })` call;
 *   * the same key space (`name` + the non-empty `qualifiedName`, counted as ONE declaration);
 *   * the same `classifyEdge` / `externalClaimOf` / `isContainsEdge` import from
 *     `script/m14/incoming-rule.ts` — the rule module the gate itself imports, so the two
 *     cannot disagree about what an outcome is;
 *   * the same per-project scope and the same `projectFactsForFiles` fact shape.
 *
 * It then prints what the gate does not: EVERY unresolved edge, bucketed by named cause.
 *
 * USAGE (bounded, one at a time — no background launch):
 *   BB_LIST_FILES=1 bun run script/m14/incoming-gate.ts svelte svelte 400 2> pop.txt
 *   BB_LIST_FILES=1 bun run script/m14/incoming-gate.ts svelte svelte 0   2> admitted.txt
 *   bun run validation/m14/fixtures/svelte/probe-residual-bucket.ts pop.txt admitted.txt
 *
 * It reads only; it writes nothing.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, isContainsEdge, type ExternalClaim } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CR_PREFIX = CR.endsWith("/") ? CR : CR + "/"
const repoOf = (f: string): string => path.join(CR, f.startsWith(CR_PREFIX) ? f.slice(CR_PREFIX.length).split(path.sep)[0] : f.split(path.sep)[0])

const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls", uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}
const TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

const parseList = (p: string): string[] =>
  readFileSync(p, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("BB_LIST_FILES_FILE:"))
    .map((s) => s.slice("BB_LIST_FILES_FILE:".length).trim())

const popFile = process.argv[2]
const admittedFile = process.argv[3]
if (!popFile || !admittedFile) {
  console.error("usage: probe-residual-bucket.ts <population-list.txt> <admitted-list.txt>")
  process.exit(2)
}
const files = parseList(popFile)
const admitted = parseList(admittedFile)

/** project -> admitted project-relative paths — the gate's `projectFactsForFiles`. */
const admittedByRepo = new Map<string, Set<string>>()
for (const abs of admitted) {
  const repo = repoOf(abs)
  let set = admittedByRepo.get(repo)
  if (!set) admittedByRepo.set(repo, (set = new Set()))
  const rel = path.relative(repo, abs)
  if (rel.length > 0) set.add(rel.split(path.sep).join("/"))
}

type Pending = {
  label: string
  tgt: string
  claim: ExternalClaim | null
  sig: string
  repo: string
  srcFile: string
  line: number | null
  md: Record<string, unknown>
  /** the file's own import records: local binding -> module specifier (probe-added, for the CAUSE) */
  importOf: Map<string, string>
}

const declPos = new Map<string, { file: string; line: number }[]>()
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const pending: Pending[] = []
let parsed = 0

for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try {
    r = await parseFile(f, repo, { projectRoot: repo } as any)
  } catch {
    continue
  }
  if (!r) continue
  parsed++
  let pDecl = projectDecl.get(repo)
  if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo)
  if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  const countKey = (key: string, kind: string, line: number | null) => {
    const at = declPos.get(key)
    const pos = { file: f, line: line ?? -1 }
    if (!at) declPos.set(key, [pos])
    else if (!at.some((d) => d.file === f && d.line === pos.line)) at.push(pos)
    pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
    let ks = pKinds!.get(key)
    if (!ks) pKinds!.set(key, (ks = new Set()))
    ks.add(kind)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const kind = String(s?.kind ?? "")
    const line = Number(s?.range?.startLine ?? s?.range?.start_line ?? s?.line_start ?? s?.lineStart ?? s?.startLine ?? s?.line ?? 0) || null
    const qual = String(s?.qualifiedName ?? "")
    countKey(name, kind, line)
    if (qual.length > 0 && qual !== name) countKey(qual, kind, line)
  }
  // the local binding -> module map, for naming the cause of component/read edges.
  // The record shape is the JS delegate's `ImportInfo`: { name, path, alias?, type, isExternal, line }.
  const importOf = new Map<string, string>()
  for (const imp of Array.isArray(r.imports) ? r.imports : []) {
    const mod = String((imp as any)?.path ?? (imp as any)?.module ?? (imp as any)?.source ?? "")
    if (mod === "") continue
    const nm = String((imp as any)?.name ?? "")
    const alias = String((imp as any)?.alias ?? "")
    if (nm !== "" && nm !== "*") importOf.set(nm, mod)
    if (alias !== "") importOf.set(alias, mod)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = LABEL_ALIASES[String(rel?.type ?? rel?.relationshipType ?? "")]
    if (!label) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (tgt.length === 0) continue
    const md = ((rel as any)?.metadata ?? {}) as Record<string, unknown>
    const markKeys = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null)
    markKeys.sort()
    pending.push({
      label, tgt, claim: externalClaimOf(rel), sig: markKeys.length ? markKeys.join("+") : "(no marker)",
      repo, srcFile: f, line: Number((rel as any)?.line_number ?? (rel as any)?.lineNumber ?? 0) || null,
      md, importOf,
    })
  }
}

// ---------------------------------------------------------------- classify (gate's own rule)
const tally = new Map<string, { edges: number; resolved: number; collRes: number; amb: number; unres: number; extOK: number; extQ: number; extFAIL: number; bindOK: number; bindQ: number; bindFAIL: number; causeOK: number; causeFAIL: number }>()
for (const t of TYPES) tally.set(t, { edges: 0, resolved: 0, collRes: 0, amb: 0, unres: 0, extOK: 0, extQ: 0, extFAIL: 0, bindOK: 0, bindQ: 0, bindFAIL: 0, causeOK: 0, causeFAIL: 0 })
const intent = { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, noDeclaration: 0 }
const LINE_IS_TARGET_LINE = new Set(["contains", "exports"])
type Unres = { label: string; tgt: string; sig: string; srcFile: string; line: number | null; md: Record<string, unknown>; importOf: Map<string, string> }
const unres: Unres[] = []
/** EVERY EDGE A CLAIM MOVED OUT OF `unresolved` — the worklist STATICALLY checked by hand in
 *  `SVELTE-FIX.md` §6. Collected from the outcome, not from the marker, so an edge that carries a
 *  key the arbiter does not read cannot appear here. */
const claimed: Array<Unres & { by: string }> = []

for (const e of pending) {
  const t = tally.get(e.label)!
  t.edges++
  const pDecl = projectDecl.get(e.repo)!
  const pKinds = projectKinds.get(e.repo)!
  const facts = { packages: new Set<string>(), files: admittedByRepo.get(e.repo) ?? new Set<string>(), sdkLib: false }
  const ownFileDeclares = (declPos.get(e.tgt) ?? []).some((d) => d.file === e.srcFile)
  const c = classifyEdge(pDecl, pKinds, e.tgt, e.claim, facts, isContainsEdge(e.label), ownFileDeclares)
  if (c.outcome === "resolved") { t.resolved++; if (c.decls > 1) t.collRes++ }
  else if (c.outcome === "ambDeclOnly" || c.outcome === "ambBoth") t.amb++
  else if (c.outcome === "externalVerified") {
    t.extOK++
    const by = e.md.importProjectFile ? "importProjectFile"
      : e.md.sourcePathClaim ? "sourcePathClaim"
      : e.md.isExternal === true ? "isExternal" : "(other)"
    claimed.push({ label: e.label, tgt: e.tgt, sig: e.sig, srcFile: e.srcFile, line: e.line, md: e.md, importOf: e.importOf, by })
  }
  else if (c.outcome === "externalUnverified") t.extQ++
  else if (c.outcome === "externalRefuted") t.extFAIL++
  else if (c.outcome === "bindingVerified") t.bindOK++
  else if (c.outcome === "bindingUnverified") t.bindQ++
  else if (c.outcome === "bindingRefuted") t.bindFAIL++
  else if (c.outcome === "causeDeclared") t.causeOK++
  else if (c.outcome === "causeRefuted") t.causeFAIL++
  else { t.unres++; unres.push({ label: e.label, tgt: e.tgt, sig: e.sig, srcFile: e.srcFile, line: e.line, md: e.md, importOf: e.importOf }) }
  // binding intent, the gate's exact test
  const decls = declPos.get(e.tgt)
  if (!decls || decls.length === 0) intent.noDeclaration++
  else {
    const sameFile = decls.filter((d) => d.file === e.srcFile)
    if (sameFile.length === 0) intent.arbitraryTwin++
    else if (LINE_IS_TARGET_LINE.has(e.label) && e.line !== null && sameFile.some((d) => d.line === e.line)) intent.intended++
    else intent.sameFileUnproven++
  }
}

const sum = (k: keyof (typeof tally extends Map<string, infer V> ? V : never)) => [...tally.values()].reduce((a, r) => a + (r[k] as number), 0)
console.log(`population: ${parsed} parsed of ${files.length} sampled · admitted ${admitted.length} (facts source)\n`)
console.log("type          edges    resolved  collRes  amb      unresolved  extOK  extQ  extFAIL  causeOK  causeFAIL")
for (const t of TYPES) {
  const r = tally.get(t)!
  if (r.edges === 0) continue
  console.log(
    `${t.padEnd(13)} ${String(r.edges).padEnd(8)} ${String(r.resolved).padEnd(9)} ${String(r.collRes).padEnd(8)} ${String(r.amb).padEnd(8)} ${String(r.unres).padEnd(11)} ${String(r.extOK).padEnd(6)} ${String(r.extQ).padEnd(5)} ${String(r.extFAIL).padEnd(8)} ${String(r.causeOK).padEnd(8)} ${r.causeFAIL}`,
  )
}
console.log(
  `${"TOTAL".padEnd(13)} ${String(sum("edges")).padEnd(8)} ${String(sum("resolved")).padEnd(9)} ${String(sum("collRes")).padEnd(8)} ${String(sum("amb")).padEnd(8)} ${String(sum("unres")).padEnd(11)} ${String(sum("extOK")).padEnd(6)} ${String(sum("extQ")).padEnd(5)} ${String(sum("extFAIL")).padEnd(8)} ${String(sum("causeOK")).padEnd(8)} ${sum("causeFAIL")}`,
)
console.log(`\nbinding intent: intended ${intent.intended} · sameFileUnproven ${intent.sameFileUnproven} · arbitraryTwin ${intent.arbitraryTwin} · noDeclaration ${intent.noDeclaration}\n`)

// ---------------------------------------------------------------- unresolved, bucketed by cause
const RELATIVE = /^\.\.?\//
const PACKAGE = /^(?:@[^/]+\/[^/]+|[a-z0-9][a-z0-9._-]*)(?:\/|$)/
/** The four specifier classes that decide what an unresolved edge could honestly claim. */
const moduleKind = (spec: string): string => {
  if (RELATIVE.test(spec)) return "RELATIVE-PATH (project file)"
  if (spec.startsWith("$")) return "$-ALIAS (project path)"
  if (spec.includes("/")) return "BARE-PACKAGE-SUBPATH"
  return "BARE-PACKAGE"
}
const buckets = new Map<string, Unres[]>()
const causeOf = (u: Unres): string => {
  // 1. an `imports` edge: the target is `<specifier>:<item>` (the SFC's own qualified form)
  if (u.label === "imports") {
    const colon = u.tgt.lastIndexOf(":")
    const spec = colon > 0 ? u.tgt.slice(0, colon) : u.tgt
    if (RELATIVE.test(spec)) return "imports: local relative specifier, file not resolvable by name"
    if (spec.startsWith("$")) return "imports: $-alias specifier ($lib/$app/...), not a name"
    if (PACKAGE.test(spec)) return "imports: bare package specifier (external dependency)"
    return "imports: other specifier shape"
  }
  // 2. component usage: dotted tag, namespace member of an imported module
  if (u.label === "instantiates" && u.tgt.includes(".")) {
    if (!u.md.namespaceBinding) return "instantiates: dotted tag, RUNTIME namespace (script symbol / template local)"
    const ns = u.tgt.slice(0, u.tgt.indexOf("."))
    const mod = u.importOf.get(ns)
    if (mod === undefined) return "instantiates: dotted tag, namespace binding module UNKNOWN"
    return `instantiates: dotted tag, namespace bound by a ${moduleKind(mod)} import`
  }
  // 3. component usage bound by an import in the SAME file
  if (u.label === "instantiates" && u.importOf.has(u.tgt)) {
    return `instantiates: component bound by a ${moduleKind(u.importOf.get(u.tgt)!)} import`
  }
  if (u.label === "instantiates") return "instantiates: tag with no import binding in this file"
  // 4. reads/calls/references bound by an import in the same file
  if (u.importOf.has(u.tgt)) {
    return `${u.label}: name bound by a ${moduleKind(u.importOf.get(u.tgt)!)} import`
  }
  return `${u.label}: no import binding in this file (member read / template read / local)`
}
for (const u of unres) {
  const key = causeOf(u)
  const list = buckets.get(key)
  if (list) list.push(u)
  else buckets.set(key, [u])
}
console.log("UNRESOLVED BY NAMED CAUSE (every edge, not a sample)")
for (const [key, list] of [...buckets].sort((a, b) => b[1].length - a[1].length)) {
  const rel = list.map((u) => `${path.relative(CR, u.srcFile)}:${u.line ?? "?"}`)
  console.log(`\n  ${String(list.length).padStart(5)}  ${key}`)
  const byTgt = new Map<string, number>()
  for (const u of list) byTgt.set(u.tgt, (byTgt.get(u.tgt) ?? 0) + 1)
  console.log(`         distinct targets ${byTgt.size} · top: ${[...byTgt].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${t}×${n}`).join(" · ")}`)
  console.log(`         signatures: ${[...new Set(list.map((u) => u.sig))].slice(0, 6).join(" | ")}`)
  console.log(`         sites: ${rel.slice(0, 4).join(", ")}${rel.length > 4 ? ` … +${rel.length - 4}` : ""}`)
}
if (unres.length === 0) console.log("  (none)")

// ------------------------ the cap's own contribution (BB_CORPUS_CENSUS=1)
//
// THE QUESTION: of the residual this 400-FILE STRIDE measures, how much is an artifact of the
// sample? The gate's header warns that a stride truncates each project's symbol table, so a name
// whose declaration lives in an unsampled file reads absent here. This arm parses EVERY admitted
// file (the same 6,147 the gate's `admitted` list holds) and answers, for the unresolved targets:
// is the target's own name declared anywhere in its project, and is the name a rebase would land
// on (the LEAF) declared — and how widely? A leaf declared across many files is the collRes trap
// measured rather than asserted.
if (process.env.BB_CORPUS_CENSUS === "1") {
  const perRepo = new Map<string, Map<string, { decls: number; files: Set<string> }>>()
  let ci = 0
  const workers = Array.from({ length: 8 }, async () => {
    while (true) {
      const k = ci++
      if (k >= admitted.length) return
      const f = admitted[k]
      const repo = repoOf(f)
      let r: any
      try {
        r = await parseFile(f, repo, { projectRoot: repo } as any)
      } catch {
        continue
      }
      let m = perRepo.get(repo)
      if (!m) perRepo.set(repo, (m = new Map()))
      for (const s of Array.isArray(r?.symbols) ? r.symbols : []) {
        const n = String(s?.name ?? "")
        if (n === "") continue
        const e = m.get(n) ?? { decls: 0, files: new Set<string>() }
        e.decls++
        e.files.add(f)
        m.set(n, e)
      }
    }
  })
  await Promise.all(workers)
  const ownRepoOf = (u: Unres): string => repoOf(u.srcFile)
  const leafOf = (tgt: string): string => {
    if (tgt.includes(":")) return tgt.slice(tgt.lastIndexOf(":") + 1)
    if (tgt.includes(".")) return tgt.slice(tgt.lastIndexOf(".") + 1)
    return tgt
  }
  const rootOf = (tgt: string): string => (tgt.includes(".") ? tgt.slice(0, tgt.indexOf(".")) : tgt)
  console.log(`\nCAP CENSUS — whole admitted population ${admitted.length} .svelte files parsed · ${perRepo.size} projects`)
  const rows: Array<{ name: string; n: number; bucket: string; total: number; leafDecls: number; leafFiles: number; rootDecls: number }> = []
  for (const [key, list] of buckets) {
    for (const [tgt, n] of (() => {
      const c = new Map<string, number>()
      for (const u of list) c.set(u.tgt, (c.get(u.tgt) ?? 0) + 1)
      return [...c]
    })()) {
      const sample = list.find((u) => u.tgt === tgt)!
      const table = perRepo.get(ownRepoOf(sample)) ?? new Map()
      rows.push({
        name: tgt, n, bucket: key,
        total: table.get(tgt)?.decls ?? 0,
        leafDecls: table.get(leafOf(tgt))?.decls ?? 0,
        leafFiles: table.get(leafOf(tgt))?.files.size ?? 0,
        rootDecls: table.get(rootOf(tgt))?.decls ?? 0,
      })
    }
  }
  // aggregate by bucket: how many target NAMES are declared somewhere in the WHOLE project
  const agg = new Map<string, { edges: number; names: number; namesDeclaredWhole: number; namesWithDeclaredLeaf: number; leafDecls: number; leafFiles: number }>()
  for (const r of rows) {
    const a = agg.get(r.bucket) ?? { edges: 0, names: 0, namesDeclaredWhole: 0, namesWithDeclaredLeaf: 0, leafDecls: 0, leafFiles: 0 }
    a.edges += r.n
    a.names++
    if (r.total > 0) a.namesDeclaredWhole++
    if (r.leafDecls > 0) { a.namesWithDeclaredLeaf++; a.leafDecls += r.leafDecls; a.leafFiles += r.leafFiles }
    agg.set(r.bucket, a)
  }
  console.log("bucket                                                                  edges  names  name-declared-whole  names-with-declared-LEAF  leaf-decls  leaf-files")
  for (const [k, a] of [...agg].sort((x, y) => y[1].edges - x[1].edges)) {
    console.log(`${k.padEnd(70)} ${String(a.edges).padStart(5)}  ${String(a.names).padStart(5)}  ${String(a.namesDeclaredWhole).padStart(19)}  ${String(a.namesWithDeclaredLeaf).padStart(23)}  ${String(a.leafDecls).padStart(10)}  ${String(a.leafFiles).padStart(10)}`)
  }
  console.log("\nTHE TOP CAUSE'S OWN NAMES (whole-project declaration count of the target, its LEAF, its ROOT):")
  for (const r of rows.filter((x) => x.bucket.startsWith("instantiates: dotted tag, namespace bound by a $-ALIAS")).sort((a, b) => b.n - a.n).slice(0, 12)) {
    console.log(`  ${String(r.n).padStart(3)}× ${r.name.padEnd(28)} target ${r.total} · LEAF ${leafOf(r.name)}=${r.leafDecls} decls in ${r.leafFiles} files · ROOT ${rootOf(r.name)}=${r.rootDecls}`)
  }
  console.log("THE CAPITALISED PLAIN TAGS BOUND BY A `$lib` IMPORT (the same seam, one step simpler):")
  for (const r of rows.filter((x) => x.bucket.startsWith("instantiates: component bound by a $-ALIAS")).sort((a, b) => b.n - a.n).slice(0, 8)) {
    console.log(`  ${String(r.n).padStart(3)}× ${r.name.padEnd(28)} target ${r.total} · whole-project declarations of this exact name`)
  }
  console.log("THE `$lib` IMPORT ITEMS (the module's declarations live outside this lane's population):")
  for (const r of rows.filter((x) => x.bucket.startsWith("imports: $-alias")).sort((a, b) => b.n - a.n).slice(0, 8)) {
    console.log(`  ${String(r.n).padStart(3)}× ${r.name.padEnd(46)} item ${leafOf(r.name)}=${r.leafDecls} decls in ${r.leafFiles} whole-project files`)
  }
}

// ------------------------------------------------- claims that moved an edge (BB_DUMP_CLAIMS=1)
if (process.env.BB_DUMP_CLAIMS === "1") {
  console.log(`\nCLAIM MOVED EDGES — ${claimed.length} of ${sum("extOK")} extOK carry a key this change set`)
  const byKey = new Map<string, number>()
  for (const c of claimed) byKey.set(c.by, (byKey.get(c.by) ?? 0) + 1)
  console.log(`  by key: ${[...byKey].map(([k, n]) => `${k} ${n}`).join(" · ")}`)
  for (const c of claimed) {
    const spec = String(c.md.module ?? "")
    console.log(
      `  [${c.by}] ${c.label} ${path.relative(CR, c.srcFile)}:${c.line ?? "?"} -> ${c.tgt}` +
        (spec ? `  (module ${spec})` : "") +
        (c.by === "importProjectFile" ? `  candidate ${String(c.md.importProjectFile)}` : ""),
    )
  }
}

