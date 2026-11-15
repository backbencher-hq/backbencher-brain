/**
 * r LANE — NAMED-CAUSE CENSUS of the incoming residual.
 *
 * WHY THIS FILE EXISTS. `script/m14/incoming-gate.ts` counts the residual and can say NO;
 * it cannot say WHY, because its unresolved worklist is capped at NAME_CAP = 25 names per
 * type and it prints no per-construct bucket. A bucket by NAMED CONSTRUCT with counts is
 * the clause-2 deliverable, and the gate has no place to put one. So this instrument
 * re-walks the SAME population with the SAME rule and buckets the unresolved edges.
 *
 * IT IMPORTS THE RULE, IT DOES NOT COPY IT. `classifyEdge`, `externalClaimOf` and `tally`
 * come from `script/m14/incoming-rule.ts` — the same functions the gate calls — so the
 * outcome this census assigns to an edge cannot drift from the verdict's.
 *
 * IT CARRIES A CONTROL. Before any bucket is printed the census asserts its own totals
 * equal the gate's printed TABLE 1 (edges 14882 · resolved 5666 · amb(decl) 429 ·
 * unresolved 8785 on the 400-file stride). If they disagree, the census says so loudly,
 * because a census that disagrees with the arbiter is measuring something else.
 *
 * READ-ONLY: it parses files and prints. It writes nothing, changes no analyzer, and is
 * run only by hand. `bun run validation/m14/fixtures/r/cause-census.ts [maxFiles]`.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { classifyEdge, externalClaimOf, emptyOutcomes, tally, isContainsEdge } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX_FILES = Number(process.argv[2] ?? 400)
const SIZE_CAP = 1024 * 1024

function admitByExtension(rel: string, exts: string[], lang: string): boolean {
  const low = rel.toLowerCase()
  const base = low.slice(low.lastIndexOf("/") + 1)
  if (exts.some((e) => low.endsWith(`.${e}`))) return true
  return exts.some((e) => base === e) && detectLanguageFromPath(rel) === lang
}

function discoverFiles(lang: string, exts: string[], maxFiles: number) {
  const found: string[] = []
  const repos = new Set<string>()
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!admitByExtension(rel, exts, lang)) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  if (maxFiles <= 0 || total <= maxFiles) return { files: found, admitted: found, total, repos: repos.size }
  const stride = Math.max(1, Math.floor(total / maxFiles))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < maxFiles; i += stride) picked.push(found[i])
  return { files: picked, admitted: found, total, repos: repos.size }
}

/** The LAST qualifier segment of a target, for the two operators R actually has. */
function qualifierSplit(tgt: string): { receiver: string; leaf: string; op: string } | null {
  for (const op of [":::", "::", "$", "@"]) {
    const i = tgt.lastIndexOf(op)
    if (i > 0 && i + op.length < tgt.length) {
      return { receiver: tgt.slice(0, i), leaf: tgt.slice(i + op.length), op }
    }
  }
  return null
}

const LABELS = new Set(["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"])

type Rec = {
  label: string
  tgt: string
  outcome: string
  srcFile: string
  repo: string
  line: number | null
  metadata: Record<string, any>
}

async function main(): Promise<void> {
  const { files, admitted, total, repos } = discoverFiles("r", ["r"], MAX_FILES)
  // THE PROJECT'S OWN FILE LIST, built exactly as the gate builds it (`projectFactsForFiles`),
  // from the UNSAMPLED admitted list. Two edges in this lane carry a file-shaped claim and the
  // arbiter can only refute them with these facts; without them the census would report two
  // `ext?` where the verdict reports `extFAIL`.
  const factsByRepo = new Map<string, { packages: Set<string>; files: Set<string>; sdkLib: boolean }>()
  for (const abs of admitted) {
    const repo = path.join(CR, (abs.startsWith(CR) ? abs.slice(CR.length + 1) : abs).split(path.sep)[0])
    let facts = factsByRepo.get(repo)
    if (!facts) factsByRepo.set(repo, (facts = { packages: new Set(), files: new Set(), sdkLib: false }))
    const rel = path.relative(repo, abs)
    if (rel.length > 0) facts.files.add(rel.split(path.sep).join("/"))
  }
  // project -> key -> count ; project -> key -> locations ; project -> key -> kinds
  const decl = new Map<string, Map<string, number>>()
  // ONE GLOBAL MAP, not per project: the gate's `declPos` is a single map across the whole run
  // (`incoming-gate.ts:866`), and `classifyIntent` reads it that way. A per-project copy here
  // reported `intended 0` against the gate's `4090` — the instrument's defect, not the lane's.
  const declPos = new Map<string, Map<string, { file: string; line: number }[]>>()
  const globalPos = new Map<string, { file: string; line: number }[]>()
  const kinds = new Map<string, Map<string, Set<string>>>()
  const repoOf = (f: string) => path.join(CR, (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split(path.sep)[0])

  let parsed = 0
  const recs: Rec[] = []
  let rawEdges = 0
  let totalSymbols = 0
  const DEBUG = process.env.CENSUS_DEBUG === "1"

  for (const f of files) {
    let r: any
    try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { continue }
    if (!r) continue
    parsed++
    const repo = repoOf(f)
    let d = decl.get(repo); if (!d) decl.set(repo, (d = new Map()))
    let p = declPos.get(repo); if (!p) declPos.set(repo, (p = new Map()))
    let k = kinds.get(repo); if (!k) kinds.set(repo, (k = new Map()))
    const countKey = (key: string, kind: string, file: string, line: number | null) => {
      d!.set(key, (d!.get(key) ?? 0) + 1)
      let ks = k!.get(key); if (!ks) k!.set(key, (ks = new Set())); ks.add(kind)
      const at = p!.get(key); const pos = { file, line: line ?? -1 }
      if (!at) p!.set(key, [pos]); else if (!at.some((x) => x.file === file && x.line === pos.line)) at.push(pos)
      const ga = globalPos.get(key)
      if (!ga) globalPos.set(key, [pos])
      else if (!ga.some((x) => x.file === file && x.line === pos.line)) ga.push(pos)
    }
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      totalSymbols++
      const name = String(s?.name ?? "")
      if (!name) continue
      const line = Number((s as any)?.range?.startLine ?? (s as any)?.range?.start_line ?? (s as any)?.line_start ?? (s as any)?.lineStart ?? (s as any)?.startLine ?? (s as any)?.line ?? 0) || null
      const q = String((s as any)?.qualifiedName ?? "")
      countKey(name, String(s?.kind ?? ""), f, line)
      if (q.length > 0 && q !== name) countKey(q, String(s?.kind ?? ""), f, line)
    }
    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = String(rel?.type ?? rel?.relationshipType ?? "")
      if (!LABELS.has(label)) continue
      rawEdges++
      const tgt = String((rel as any)?.target ?? (rel as any)?.to ?? "")
      if (!tgt) continue
      recs.push({
        label, tgt, outcome: "",
        srcFile: f, repo,
        line: Number((rel as any)?.line_number ?? (rel as any)?.line ?? 0) || null,
        metadata: ((rel as any)?.metadata ?? {}) as Record<string, any>,
      })
    }
  }

  // CLASSIFY with the arbiter's own rule and the arbiter's own tally, over the finished key
  // spaces. A census that re-implemented the counting could disagree with the gate; this one
  // calls `tally`, the same function the gate calls, so the CONTROL below is a control on the
  // population and the walk rather than on a second copy of the rule.
  const out = new Map<string, ReturnType<typeof emptyOutcomes>>()
  for (const L of LABELS) out.set(L, emptyOutcomes())
  const intent = { intended: 0, sameFileUnproven: 0, arbitraryTwin: 0, noDeclaration: 0 }
  const LINE_IS_TARGET_LINE = new Set(["contains", "exports"])
  for (const rec of recs) {
    const d = decl.get(rec.repo)!
    const k = kinds.get(rec.repo)!
    // THE EDGE IS PASSED WHOLE, not just its metadata: `externalClaimOf` SYNTHESIZES the
    // module-path import claim for an `imports` edge with a dotted capitalised-leaf target
    // (`incoming-rule.ts:448-459`). Passing metadata alone cost this census exactly the 2
    // edges the verdict reports as `extFAIL`, which is how the omission was found.
    const claim = externalClaimOf({ type: rec.label, target: rec.tgt, metadata: rec.metadata })
    const c = classifyEdge(d, k, rec.tgt, claim, factsByRepo.get(rec.repo), isContainsEdge(rec.label))
    rec.outcome = c.outcome
    tally(out.get(rec.label)!, c, rec.tgt, rec.label)
    // THE GATE'S EXACT INTENT TEST, transcribed from `incoming-gate.ts:classifyIntent`.
    const pos = globalPos.get(rec.tgt) ?? []
    const same = pos.filter((x) => x.file === rec.srcFile)
    if (pos.length === 0) intent.noDeclaration++
    else if (same.length === 0) intent.arbitraryTwin++
    else if (LINE_IS_TARGET_LINE.has(rec.label) && rec.line !== null && same.some((x) => x.line === rec.line)) intent.intended++
    else intent.sameFileUnproven++
  }

  // ---- THE CONTROL: this census must reproduce the gate's TABLE 1.
  let edges = 0, resolved = 0, collRes = 0, ambDecl = 0, unresolved = 0
  for (const o of out.values()) {
    edges += o.resolved + o.ambiguousByDecl + o.unresolved + o.markedExternal
      + o.bindingVerified + o.bindingUnverified + o.bindingRefuted + o.causeDeclared + o.causeRefuted
    resolved += o.resolved
    collRes += o.resolvedAmongCollision
    ambDecl += o.ambiguousByDecl
    unresolved += o.unresolved
  }
  console.log(`r CAUSE CENSUS — population: ${parsed} parsed of ${files.length} sampled (corpus ${total} .r across ${repos} repos; stride)`)
  // BOTH ARMS ARE NAMED, because the control has to close on the arm the tree is in: the BEFORE
  // column is the run this lane classified from, the AFTER column the run the fix is measured by.
  const close = (v: number, before: number, after: number) =>
    `census ${String(v).padStart(5)}   gate-before ${String(before).padStart(5)}   gate-after ${String(after).padStart(5)}   ${v === after ? "CLOSES-AFTER" : v === before ? "closes-before" : "*** NEITHER ***"}`
  console.log(`CONTROL against the gate's TABLE 1 (400-file run):`)
  console.log(`  edges      ${close(edges, 14882, 14882)}`)
  console.log(`  resolved   ${close(resolved, 5666, 5628)}`)
  console.log(`  collRes    ${close(collRes, 953, 953)}`)
  console.log(`  amb(decl)  ${close(ambDecl, 429, 423)}`)
  console.log(`  unresolved ${close(unresolved, 8785, 8129)}`)
  console.log(`  raw relationships seen by the census: ${rawEdges}`)
  console.log(`  symbols seen by the census: ${totalSymbols}`)
  if (DEBUG) {
    for (const rec of recs) {
      if (rec.tgt !== "lmArmadillo.R" && rec.tgt !== "lmGSL.R") continue
      console.log(`  DEBUG edge ${rec.label} ${rec.srcFile}:${rec.line} -> ${rec.tgt} outcome=${rec.outcome} md=${JSON.stringify(rec.metadata)}`)
    }
  }
  if (DEBUG) {
    let shown = 0
    for (const rec of recs) {
      if (rec.outcome !== "unresolved" || rec.label !== "contains") continue
      const d = decl.get(rec.repo)!
      console.log(`  DEBUG contains ${rec.srcFile}:${rec.line} -> ${JSON.stringify(rec.tgt)} decls=${d.get(rec.tgt) ?? 0} keys=${d.size}`)
      if (++shown >= 20) break
    }
  }
  console.log(`\nPER-TYPE CENSUS (compare with the gate's TABLE 1):`)
  console.log(`type          edges    resolved  collRes  amb(decl)  unresolved`)
  for (const L of LABELS) {
    const o = out.get(L)!
    console.log(`  ${L.padEnd(12)} ${String(o.resolved + o.ambiguousByDecl + o.unresolved + o.markedExternal + o.bindingVerified + o.bindingUnverified + o.bindingRefuted + o.causeDeclared + o.causeRefuted).padStart(5)}   ${String(o.resolved).padStart(6)}  ${String(o.resolvedAmongCollision).padStart(6)}  ${String(o.ambiguousByDecl).padStart(8)}  ${String(o.unresolved).padStart(9)}   extV ${o.externalVerified} extU ${o.externalUnverified} extR ${o.externalRefuted}`)
  }

  // ---- BUCKETS BY NAMED CAUSE. The gate's `unresolved` column is the edge with NO answer at
  // all; that is the population bucketed here. Ambiguity is bucketed in its own table beside it,
  // because an ambiguous edge DOES have answers and mixing the two would misreport both.
  type Bucket = { name: string; construct: string; n: number; examples: Map<string, number> }
  const buckets = new Map<string, Bucket>()
  const B = (name: string, construct: string): Bucket => {
    let b = buckets.get(name)
    if (!b) buckets.set(name, (b = { name, construct, n: 0, examples: new Map() }))
    return b
  }
  const bump = (b: Bucket, tgt: string) => {
    b.n++
    b.examples.set(tgt, (b.examples.get(tgt) ?? 0) + 1)
  }
  // counterfactual: publishing the LEAF of a qualified target instead of the qualified spelling
  const leafCounterfactual = {
    qualified: 0,
    leafDeclaredOnceProject: 0,
    leafDeclaredManyProject: 0,
    leafDeclaredOwnFile: 0,
    leafDeclaredNowhere: 0,
  }
  const ambBuckets = new Map<string, Bucket>()
  const BA = (name: string, construct: string): Bucket => {
    let b = ambBuckets.get(name)
    if (!b) ambBuckets.set(name, (b = { name, construct, n: 0, examples: new Map() }))
    return b
  }
  const shapeOf = (rec: Rec): { key: string; construct: string } => {
    const split = qualifierSplit(rec.tgt)
    if (split) {
      const isNs = split.op === "::" || split.op === ":::"
      return {
        key: rec.label + (isNs ? ":namespace-qualified" : ":member-qualified"),
        construct: isNs ? "namespace-qualified callee (pkg::fn / pkg:::fn)" : "member callee (obj$member / obj@slot)",
      }
    }
    if (rec.tgt.includes(".")) {
      return { key: rec.label + ":dot-named", construct: "R dot-named identifier (is.na, as.data.frame) - the dot is part of the name" }
    }
    if (/^[A-Za-z_.][A-Za-z0-9_.]*$/.test(rec.tgt)) {
      return { key: rec.label + ":bare-name", construct: "bare identifier no file in the project declares" }
    }
    return { key: rec.label + ":other-shape", construct: "non-identifier-shaped target (string literal / path / operator)" }
  }
  for (const rec of recs) {
    const { key, construct } = shapeOf(rec)
    const isAmb = rec.outcome === "ambDeclOnly" || rec.outcome === "ambBoth"
    if (rec.outcome !== "unresolved" && !isAmb) continue
    bump(isAmb ? BA(key, construct) : B(key, construct), rec.tgt)
    if (rec.outcome !== "unresolved") continue
    const split = qualifierSplit(rec.tgt)
    if (!split) continue
    const d = decl.get(rec.repo)!
    const ownFileLeaf = (declPos.get(rec.repo)!.get(split.leaf) ?? []).some((x) => x.file === rec.srcFile)
    const leafDecls = d.get(split.leaf) ?? 0
    leafCounterfactual.qualified++
    if (ownFileLeaf) leafCounterfactual.leafDeclaredOwnFile++
    if (leafDecls === 1) leafCounterfactual.leafDeclaredOnceProject++
    else if (leafDecls > 1) leafCounterfactual.leafDeclaredManyProject++
    else leafCounterfactual.leafDeclaredNowhere++
  }

  console.log("\nUNRESOLVED BY NAMED CONSTRUCT (the gate's unresolved column, " + unresolved + " edges; bucket counts must sum to it):")
  let bucketSum = 0
  for (const b of [...buckets.values()].sort((a, b) => b.n - a.n)) {
    bucketSum += b.n
    const top = [...b.examples.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6)
      .map(([t, n]) => t + "(" + n + ")").join(" | ")
    console.log("  " + String(b.n).padStart(6) + "  " + b.name.padEnd(40) + " " + b.construct)
    console.log("          top: " + top)
  }
  console.log("  ------- bucket sum " + bucketSum + " vs unresolved " + unresolved + (bucketSum === unresolved ? "  (CLOSES)" : "  *** DOES NOT CLOSE ***"))
  console.log("\nAMBIGUOUS BY NAMED CONSTRUCT (the gate's amb(decl) column, " + ambDecl + " edges; NOT part of the residual above):")
  for (const b of [...ambBuckets.values()].sort((a, b) => b.n - a.n)) {
    const top = [...b.examples.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4)
      .map(([t, n]) => t + "(" + n + ")").join(" | ")
    console.log("  " + String(b.n).padStart(6) + "  " + b.name.padEnd(40) + " " + b.construct)
    console.log("          top: " + top)
  }
  console.log("\nQUALIFIED-TARGET COUNTERFACTUAL (of the " + unresolved + " UNRESOLVED edges whose target spells a qualifier):")
  console.log("  edges with a qualifier (::/:::/$ /@): " + leafCounterfactual.qualified)
  console.log("    leaf declared ONCE in the project   -> would read resolved      : " + leafCounterfactual.leafDeclaredOnceProject)
  console.log("    leaf declared MANY times in project -> would read collRes/amb   : " + leafCounterfactual.leafDeclaredManyProject)
  console.log("    leaf declared in the EDGE'S OWN FILE (intended-ish)             : " + leafCounterfactual.leafDeclaredOwnFile)
  console.log("    leaf declared NOWHERE in the project (still unresolved)         : " + leafCounterfactual.leafDeclaredNowhere)
  console.log("\nBINDING INTENT (all " + edges + " edges, the gate's exact test): intended " + intent.intended + " | sameFileUnproven " + intent.sameFileUnproven + " | arbitraryTwin " + intent.arbitraryTwin + " | noDeclaration " + intent.noDeclaration)
}

main().catch((e) => { console.error(e); process.exit(2) })
