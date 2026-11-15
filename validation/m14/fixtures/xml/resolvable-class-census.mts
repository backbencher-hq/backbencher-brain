// XML — PER-CLASS CENSUS, AND A WHAT-IF FOR THE CLAIM MAPPING.
//
// WHY THIS FILE EXISTS. The incoming gate counts `references` and `imports` edges as
// `unresolved` over this lane's population, and `unresolved` is a bucket the gate treats as the
// lane's own defect. The analyzer already classifies every one of those edges —
// `metadata.resolvable` is `in-document | builtin | external | unresolved` on `references` and
// `in-document | file | external` on `imports` — but carries none of the gate's CLAIM KEYS, so the
// gate cannot tell a built-in from a broken name.
//
// THE RULE IS IMPORTED, NOT COPIED. `classifyEdge` comes from `script/m14/incoming-rule.ts`, the
// same function the gate runs, so this census and the verdict cannot disagree about what an
// outcome means. Its no-claim column is a CONTROL: it must reproduce the gate's own per-type
// table on the same population, and if it does not, the walk is not the gate's walk and nothing
// below it may be quoted.
//
// WHAT A CLAIM CAN AND CANNOT VERIFY (`incoming-rule.ts`; the routing decision is made from the
// counts this file prints, never from the intuition that "external" is the right label):
//
//   `isExternalTarget`    -> owner claim. A plain identifier is VERIFIED when the key space does
//                            not declare it. A PATH-LIKE target returns externalUnverified and is
//                            NEVER refuted — `verifyExternalClaim` checks `pathLikeTarget` first
//                            precisely because asking a path an owner question manufactured 113
//                            false refutations on another lane.
//   `importProjectFile`   -> file claim. VERIFIED when ANY candidate is an admitted file, REFUTED
//                            when NONE is. A refutation is `extFAIL`, which must be 0.
//   `importOutsideProject`-> projectFacts claim; `verifyImportClaim` knows only `package:` and
//                            `dart:` spellings and returns externalUnverified for everything else,
//                            so for xml it can never verify.
//
// USAGE
//   bun validation/m14/fixtures/xml/resolvable-class-census.mts
//   BB_XML_EXTS=xml,xsd,dtd,svg,xsl,xslt,rng bun ...   # the lane's whole corpus
//   BB_XML_LIMIT=400 bun ...                           # bounded
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { classifyEdge, type ProjectFacts } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const EXTS = (process.env.BB_XML_EXTS ?? "xml").split(",").map((s) => s.trim()).filter(Boolean)
const LIMIT = Number(process.env.BB_XML_LIMIT ?? "0")
const OUT = process.env.BB_XML_OUT ?? ""

type Row = { repo: string; rel: string; abs: string }
const rows: Row[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const lower = rel.toLowerCase()
    if (!EXTS.some((e) => lower.endsWith("." + e))) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    rows.push({ repo: name, rel: rel.split(path.sep).join("/"), abs })
  }
}
const walked = LIMIT > 0 ? rows.slice(0, LIMIT) : rows

// ── the gate's key space, built the gate's way: name + qualifiedName alias, per repository
const declOf = new Map<string, Map<string, number>>()
const kindsOf = new Map<string, Map<string, Set<string>>>()
const filesOf = new Map<string, Set<string>>()
/** edges reduced to what the decision needs, classified AFTER the key space is complete — the
 *  gate's own deferred model (script/m14/incoming-gate.ts), because a streaming key space
 *  under-reports resolution by construction. */
type Edge = { repo: string; type: string; tgt: string; cls: string; role: string; docRel: string; src: string; line: number | null }
const edges: Edge[] = []
const edgeCount: Record<string, number> = {}

let parsed = 0, failed = 0, degraded = 0
for (const f of walked) {
  let r: any
  try { r = await parseFile(f.abs, path.join(CR, f.repo), { projectRoot: path.join(CR, f.repo) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
  const repo = f.repo
  if (!declOf.has(repo)) declOf.set(repo, new Map())
  if (!kindsOf.has(repo)) kindsOf.set(repo, new Map())
  if (!filesOf.has(repo)) filesOf.set(repo, new Set())
  const decl = declOf.get(repo)!, kinds = kindsOf.get(repo)!, files = filesOf.get(repo)!
  files.add(f.rel)
  const countKey = (key: string, kind: string) => {
    decl.set(key, (decl.get(key) ?? 0) + 1)
    let ks = kinds.get(key); if (!ks) kinds.set(key, (ks = new Set())); ks.add(kind)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    countKey(name, String(s?.kind ?? ""))
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) countKey(q, String(s?.kind ?? ""))
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const type = String(rel?.type ?? rel?.relationshipType ?? "")
    if (type !== "references" && type !== "imports" && type !== "contains") continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (tgt.length === 0) continue
    const md = rel?.metadata ?? {}
    edges.push({ repo, type, tgt, cls: String(md.resolvable ?? "(none)"), role: String(md.role ?? "(none)"), docRel: f.rel, src: String(rel?.source ?? ""), line: rel?.line_number ?? rel?.lineNumber ?? null })
    edgeCount[type] = (edgeCount[type] ?? 0) + 1
  }
}

const isRemote = (t: string): boolean => t.indexOf("://") > 0
function candidateFor(docRel: string, target: string): string | null {
  const clean = target.split("#")[0].split("?")[0]
  if (clean.length === 0 || isRemote(clean) || clean.startsWith("/")) return null
  const norm = path.posix.normalize(path.posix.join(path.posix.dirname(docRel || "."), clean))
  return norm.startsWith("..") ? null : norm
}
/** The outcome NAMES `classifyEdge` actually returns — read off the rule, not guessed: the first
 *  version of this file initialised `ambiguousByDecl`, a name the rule never returns, so every
 *  ambiguous edge landed on an uninitialised key and the control under-reported. */
const OUTCOMES = ["resolved", "ambDeclOnly", "ambBoth", "unresolved", "externalVerified", "externalUnverified", "externalRefuted", "bindingVerified", "bindingUnverified", "bindingRefuted", "causeDeclared", "causeRefuted"] as const
type Counts = Record<(typeof OUTCOMES)[number], number>
const counts = (): Counts => Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Counts
/** ambiguousByDecl, the gate's own sum of the two ambiguous outcomes. */
const ambDecl = (c: Counts): number => c.ambDeclOnly + c.ambBoth

/** crossTab[type][class][outcome] — the decisive table: which analyzer class the gate's
 *  `unresolved` edges actually come from. */
const crossTab: Record<string, Record<string, Record<string, number>>> = {}
/** CLAUSE 3 AUDIT. An edge the gate counts `unresolved` names nothing in ITS PROJECT — that is what
 *  the outcome means. The bar's question is whether the refusal to claim it external is itself
 *  evidenced, and the measurement that answers it is whether the name is held ANYWHERE in the
 *  corpus: a name no repository declares is not a declaration this population lost, while a name
 *  another repository declares is something the claim would have had to say precisely. Both the
 *  per-project and the pooled key space are therefore consulted for every unresolved edge. */
const unresolvedAudit: Array<{ type: string; file: string; line: number | null; source: string; target: string; analyzerClass: string; role: string; inOwnProject: boolean; inPooledCorpus: boolean; pooledRepos: string[] }> = []
const baseline: Record<string, Counts> = {}
const whatIf: Record<string, Counts> = {}
const fileProbe: Record<string, number> = { file_class_candidates_admitted: 0, file_class_candidates_absent: 0, file_class_no_candidate: 0 }
/** WHY a claim came back UNVERIFIED is a spelling question, so the spellings are recorded — up to
 *  five per (type, class, outcome). A mapping cannot be chosen from counts alone when half the
 *  claims land in a bucket whose reason is the target's shape. */
const examples: Record<string, string[]> = {}
const noteExample = (key: string, tgt: string) => {
  const list = (examples[key] ??= [])
  if (list.length < 5) list.push(tgt)
}

// the pooled key space, built once from every repository's declarations
const pooledKeys = new Map<string, Set<string>>()
for (const [repo, m] of declOf) for (const k of m.keys()) {
  let set = pooledKeys.get(k); if (!set) pooledKeys.set(k, (set = new Set())); set.add(repo)
}

for (const e of edges) {
  const decl = declOf.get(e.repo)!, kinds = kindsOf.get(e.repo)!
  // CONTROL: no claim at all — must reproduce the gate's table for this population. `contains`
  // goes through the gate's `containsLike` arm (commit fa2dc27e8, which cites THIS lane's 94.1%
  // model vs 98.4% store measurement), so the control passes it here too; without it the census
  // and the gate would disagree about every colliding containment edge.
  const containsLike = e.type === "contains"
  const b = classifyEdge(decl, kinds, e.tgt, null, undefined, containsLike)
  ;(baseline[e.type] ??= counts())[b.outcome as keyof Counts] = ((baseline[e.type] ??= counts())[b.outcome as keyof Counts] ?? 0) + 1
  crossTab[e.type] ??= {}
  crossTab[e.type][e.cls] ??= {}
  crossTab[e.type][e.cls][b.outcome] = (crossTab[e.type][e.cls][b.outcome] ?? 0) + 1

  // WHAT-IF, from the class the analyzer already publishes. Nothing here is emitted by this
  // census; it prices a mapping before the analyzer is touched.
  let claim: any = null
  if (e.type === "references") {
    if (e.cls === "builtin" || e.cls === "external") claim = { kind: "owner" }        // isExternalTarget
  } else {
    if (e.cls === "external" && isRemote(e.tgt)) claim = { kind: "owner" }            // isExternalTarget
  }
  const facts: ProjectFacts = { packages: new Set(), files: filesOf.get(e.repo) ?? new Set(), sdkLib: false }
  const w = classifyEdge(decl, kinds, e.tgt, claim, claim?.kind === "projectFile" ? facts : undefined)
  if (b.outcome === "unresolved") {
    const pooledRepos = [...(pooledKeys.get(e.tgt) ?? [])]
    unresolvedAudit.push({ type: e.type, file: e.docRel, line: e.line, source: e.src, target: e.tgt, analyzerClass: e.cls, role: e.role, inOwnProject: false, inPooledCorpus: pooledRepos.length > 0, pooledRepos })
  }
  const wi = (whatIf[e.type] ??= counts())
  wi[w.outcome as keyof Counts] = (wi[w.outcome as keyof Counts] ?? 0) + 1
  if (claim !== null && (w.outcome === "externalUnverified" || w.outcome === "externalRefuted")) {
    noteExample(`${e.type}|${e.cls}|${w.outcome}`, e.tgt)
  }

  // Would a FILE claim verify? Priced, never applied: a miss REFUTES, and extFAIL must be 0.
  if (e.type === "imports" && e.cls === "file") {
    const cand = candidateFor(e.docRel, e.tgt)
    if (cand === null) fileProbe.file_class_no_candidate++
    else if (facts.files.has(cand)) fileProbe.file_class_candidates_admitted++
    else fileProbe.file_class_candidates_absent++
  }
}

const report = {
  instrument: "xml resolvable-class census — the analyzer's own classes cross-tabulated against the GATE'S OWN RULE (classifyEdge imported from script/m14/incoming-rule.ts)",
  population: {
    corpusRoot: CR, admittedExtensions: EXTS, admitted: rows.length, walked: walked.length, limit: LIMIT,
    parsed, failed, degraded, admission: "git-tracked, <= 512 KiB, detectLanguageFromPath === 'xml'",
  },
  control: {
    rule: "the no-claim column must reproduce script/m14/incoming-gate.ts's per-type table on this population (resolved / ambDecl / unresolved); a mismatch means this walk is not the gate's walk",
    baseline,
    table: Object.fromEntries(Object.entries(baseline).map(([t, c]) => [t, {
      edges: edgeCount[t] ?? 0, resolved: c.resolved, ambDecl: ambDecl(c), unresolved: c.unresolved,
      externalVerified: c.externalVerified, externalUnverified: c.externalUnverified, externalRefuted: c.externalRefuted,
    }])),
  },
  crossTab,
  whatIf,
  clause3_unresolvedAudit: {
    note: "every edge classified `unresolved` in its OWN project, checked against the pooled corpus key space",
    count: unresolvedAudit.length,
    namesHeldNowhereInTheCorpus: unresolvedAudit.filter((u) => !u.inPooledCorpus).length,
    namesHeldInAnotherRepository: unresolvedAudit.filter((u) => u.inPooledCorpus).length,
    edges: unresolvedAudit,
  },
  examples,
  fileClaimProbe: { ...fileProbe, note: "priced only; an unadmitted candidate REFUTES a file claim, and extFAIL must be 0" },
  mappingProposed: {
    references_builtin_external: "isExternalTarget (owner claim) — identifier targets, verified when undeclared, never refuted for path-like spellings",
    references_unresolved: "no claim: the analyzer's own X13 class states the file does not satisfy the reference; marking it external would assert a fact about the population that the analyzer did not measure",
    imports_remote: "isExternalTarget (owner claim) — a URI is path-like, so the honest outcome is externalUnverified, never a false verification",
    imports_file: "no claim unless the candidate is an admitted file — priced in fileClaimProbe",
  },
}
const text = JSON.stringify(report, null, 2)
if (OUT) writeFileSync(OUT, text)
console.log(text)
