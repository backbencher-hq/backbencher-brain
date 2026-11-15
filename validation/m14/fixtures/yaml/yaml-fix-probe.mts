/**
 * YAML RESIDUAL EDGE PROBE — reproduces the incoming gate's bounded population
 * (`yaml yaml,yml 400`) and dumps every edge that is NOT clean, with the metadata
 * that says WHICH CONSTRUCT emitted it.
 *
 * This exists because the gate reports marker-KEY signatures and a capped worklist
 * of target names; it deliberately does not print metadata VALUES (one value per
 * symbol would split a marker set). A lane that must name its residual by construct
 * needs the values, so the probe reads them off the analyzer's own output using the
 * GATE'S OWN RULE MODULE (`incoming-rule.ts`), never a re-implementation.
 *
 * Control: the per-type counts this prints must equal the gate's TABLE 1 for the
 * same invocation, or the population/key-space replication is wrong and no bucket
 * below it can be trusted.
 *
 * Usage: bun run validation/m14/fixtures/yaml/yaml-fix-probe.mts [maxFiles]
 */
import { readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf } from "../../../../script/m14/incoming-rule"
import type { ProjectFacts } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = ["yaml", "yml"]
const MAX_FILES = Number(process.argv[2] ?? 400)

type Decl = { key: string; kind: string; file: string; line: number | null }

function discover(): { files: string[]; admittedByRepo: Map<string, string[]>; total: number } {
  const found: string[] = []
  const admittedByRepo = new Map<string, string[]>()
  let entries: string[]
  try { entries = readdirSync(CR) } catch { return { files: [], admittedByRepo, total: 0 } }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    const list: string[] = []
    for (const rel of tracked) {
      const low = rel.toLowerCase()
      if (!EXTS.some((e) => low.endsWith(`.${e}`))) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
      found.push(abs)
      list.push(abs)
    }
    if (list.length > 0) admittedByRepo.set(dir, list)
  }
  found.sort()
  let files = found
  if (MAX_FILES > 0 && found.length > MAX_FILES) {
    const stride = Math.max(1, Math.floor(found.length / MAX_FILES))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < MAX_FILES; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, admittedByRepo, total: found.length }
}

const { files, admittedByRepo, total } = discover()
const repoOf = (f: string): string => path.join(CR, path.relative(CR, f).split(path.sep)[0])

// THE KEY SPACE — per project, built exactly as the gate builds it: name + qualifiedName alias.
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
const declPos = new Map<string, { file: string; line: number | null; kind: string }[]>()
const pending: { label: string; tgt: string; claim: any; sig: string; repo: string; srcFile: string; line: number | null; md: any }[] = []
let parsed = 0
let failed = 0
let empty = 0

for (const f of files) {
  const repo = repoOf(f)
  let r: any
  try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if ((r.symbols ?? []).length === 0 && (r.relationships ?? []).length === 0) empty++
  let pDecl = projectDecl.get(repo)
  if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo)
  if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  const countKey = (key: string, kind: string, file: string, line: number | null) => {
    pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
    let ks = pKinds!.get(key)
    if (!ks) pKinds!.set(key, (ks = new Set()))
    ks.add(kind)
    const at = declPos.get(`${repo}\u0000${key}`)
    const pos = { file, line, kind }
    if (!at) declPos.set(`${repo}\u0000${key}`, [pos])
    else if (!at.some((d) => d.file === file && d.line === line)) at.push(pos)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const kind = String(s?.kind ?? "")
    const line = Number((s as any)?.range?.startLine ?? (s as any)?.range?.start_line ?? (s as any)?.line ?? 0) || null
    const qual = String((s as any)?.qualifiedName ?? "")
    countKey(name, kind, f, line)
    if (qual.length > 0 && qual !== name) countKey(qual, kind, f, line)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const labelMap: Record<string, string> = {
      calls: "calls", uses: "uses", contains: "contains", imports: "imports", brain_import: "imports",
      references: "references", depends_on: "references", related: "references", exports: "exports",
      provides: "exports", extends: "extends", implements: "implements", instantiates: "instantiates",
      overrides: "overrides",
    }
    const label = labelMap[String(rel?.type ?? rel?.relationshipType ?? "")]
    if (!label) continue
    const tgt = String(rel?.target ?? rel?.to ?? "")
    if (!tgt) continue
    const md = (rel as any)?.metadata ?? {}
    const keys = Object.keys(md).filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null).sort()
    const line = Number((rel as any)?.line_number ?? (rel as any)?.line ?? 0) || null
    pending.push({ label, tgt, claim: externalClaimOf(rel), sig: keys.join("+") || "(no marker)", repo, srcFile: f, line, md })
  }
}

// PROJECT FACTS for file claims: the UNSAMPLED admitted list, repo-relative POSIX.
const factsByRepo = new Map<string, ProjectFacts>()
for (const [repo, list] of admittedByRepo) {
  const set = new Set<string>()
  for (const abs of list) set.add(path.relative(CR, abs).split(path.sep).slice(1).join("/"))
  factsByRepo.set(repo, { packages: new Set<string>(), files: set, sdkLib: false })
}

type Row = { edges: number; resolved: number; collRes: number; amb: number; unresolved: number; extOK: number; extQ: number; extFail: number; bindOK: number; bindQ: number; bindFail: number; causeOK: number; causeFail: number }
const rows = new Map<string, Row>()
const getRow = (t: string): Row => {
  let r = rows.get(t)
  if (!r) rows.set(t, (r = { edges: 0, resolved: 0, collRes: 0, amb: 0, unresolved: 0, extOK: 0, extQ: 0, extFail: 0, bindOK: 0, bindQ: 0, bindFail: 0, causeOK: 0, causeFail: 0 }))
  return r
}
type Fail = { label: string; tgt: string; outcome: string; sig: string; repo: string; srcFile: string; line: number | null; md: any; source: string }
const fails: Fail[] = []
for (const e of pending) {
  const row = getRow(e.label)
  row.edges++
  if (e.label === "contains") continue
  const pDecl = projectDecl.get(e.repo) ?? new Map()
  const pKinds = projectKinds.get(e.repo) ?? new Map()
  const facts = factsByRepo.get(e.repo)
  const ownFileDeclares = (() => {
    const at = declPos.get(`${e.repo}\u0000${e.tgt}`)
    return at ? at.some((d) => d.file === e.srcFile) : undefined
  })()
  const c = classifyEdge(pDecl, pKinds, e.tgt, e.claim, facts, e.label === "contains", ownFileDeclares)
  switch (c.outcome) {
    case "resolved": row.resolved++; if (c.boundAmongCollision) row.collRes++; continue
    case "ambBoth": case "ambDeclOnly": row.amb++; break
    case "unresolved": row.unresolved++; break
    case "externalVerified": row.extOK++; continue
    case "externalUnverified": row.extQ++; break
    case "externalRefuted": row.extFail++; break
    case "bindingVerified": row.bindOK++; continue
    case "bindingUnverified": row.bindQ++; break
    case "bindingRefuted": row.bindFail++; break
    case "causeDeclared": row.causeOK++; continue
    case "causeRefuted": row.causeFail++; break
  }
  fails.push({ label: e.label, tgt: e.tgt, outcome: c.outcome, sig: e.sig, repo: e.repo, srcFile: e.srcFile, line: e.line, md: e.md, source: String(e.md?.source ?? "") })
}

const rel = (f: string): string => path.relative(CR, f)
console.log(`probe population: ${files.length} file(s) parsed (of ${total} admitted) · parse failures ${failed} · empty results ${empty}`)
console.log("")
console.log("type          edges    resolved  collRes  amb(decl)  unresolved  extOK   ext?    extFAIL  bindOK  bind?  bindFAIL  causeOK  causeFAIL")
for (const [t, r] of [...rows].sort((a, b) => b[1].edges - a[1].edges)) {
  console.log(
    `${t.padEnd(13)} ${String(r.edges).padStart(8)} ${String(r.resolved).padStart(9)} ${String(r.collRes).padStart(8)} ` +
    `${String(r.amb).padStart(10)} ${String(r.unresolved).padStart(11)} ${String(r.extOK).padStart(6)} ${String(r.extQ).padStart(6)} ` +
    `${String(r.extFail).padStart(8)} ${String(r.bindOK).padStart(7)} ${String(r.bindQ).padStart(6)} ${String(r.bindFail).padStart(8)} ` +
    `${String(r.causeOK).padStart(8)} ${String(r.causeFail).padStart(9)}`,
  )
}
console.log("")
console.log(`NOT-CLEAN EDGES: ${fails.length}`)
for (const e of fails) {
  const md = e.md
  const why = md.relationshipType ?? "(no relationshipType)"
  const reason = md.unresolvedReason ?? ""
  const conf = md.confidenceReason ?? ""
  const ptr = typeof md.pointer === "string" ? ` pointer=${JSON.stringify(md.pointer)}` : ""
  console.log(`FAIL ${e.label.padEnd(10)} ${rel(e.srcFile)}:${e.line ?? "?"} target=${JSON.stringify(e.tgt)} outcome=${e.outcome} rt=${why} reason=${JSON.stringify(reason)} conf=${JSON.stringify(conf)}${ptr} sig=${e.sig}`)
}
console.log("")
// BUCKETS BY NAMED CONSTRUCT
const bucket = new Map<string, number>()
for (const e of fails) {
  let b: string
  const rt = String(e.md?.relationshipType ?? "(none)")
  if (rt === "yaml_json_pointer") {
    const p = String(e.md?.pointer ?? "")
    b = p.startsWith("/") ? "yaml_json_pointer:in-document" : "yaml_json_pointer:cross-document/file"
  } else if (rt === "yaml_resource_ref") {
    b = "yaml_resource_ref:kubernetes-object-name"
  } else if (rt === "yaml_depends_on") {
    b = "yaml_depends_on:compose-service-or-workflow-job"
  } else if (rt === "yaml_alias" || rt === "yaml_merge") {
    b = "yaml_alias:anchor"
  } else if (rt === "declared_type") {
    b = "declared_type:tag"
  } else if (rt === "yaml_action_use_unverified") {
    b = "yaml_action_use:not-a-workflow-shape"
  } else {
    b = `other:${rt}/${e.label}`
  }
  bucket.set(b, (bucket.get(b) ?? 0) + 1)
}
console.log("BUCKETS BY NAMED CONSTRUCT:")
for (const [b, n] of [...bucket].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${b}`)
console.log("")
// CONFIDENCE-REASON VALUES on the failing edges
const confs = new Map<string, number>()
for (const e of fails) {
  const v = JSON.stringify(e.md?.confidenceReason ?? "(none)")
  confs.set(v, (confs.get(v) ?? 0) + 1)
}
console.log("confidenceReason VALUES ON NOT-CLEAN EDGES:")
for (const [v, n] of [...confs].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${v}`)
