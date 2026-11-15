/**
 * HTML LANE — THE VERBATIM-TARGET CENSUS.
 *
 * WHAT IT ANSWERS, and why it must exist before any edit to `real-html-analyzer.ts`:
 *
 *   1. THE NAMED-CAUSE BUCKETS of the lane's `unresolved` column, with counts, where each bucket
 *      names the CONSTRUCT the analyzer emitted (a navigation link, a non-network fetch, an
 *      embedded-JS callee, an idref, …) rather than restating "unresolved".
 *   2. THE CHANNEL SIMULATION: for each candidate fix, how many of those edges would VERIFY
 *      (`extOK`), how many would be REFUTED (`extFAIL` — a claim the project falsifies, which is
 *      a regression), how many would stay unresolved, and — the trap this lane was warned about —
 *      how many claims would be READ ON A TARGET THAT ALREADY HAS A DECLARATION, i.e. would move
 *      a `resolved` edge into a claim (a resolution stolen).
 *
 * FIDELITY, and it is the whole reason this file is trustworthy: the population is the GATE'S OWN
 * (its `BB_LIST_FILES=1` output, unsampled and sampled), the rule is the GATE'S OWN
 * (`script/m14/incoming-rule.ts`, imported — never copied), and the script PRINTS a closure check
 * against the gate's TOTAL row, so a census that disagreed with the arbiter would say so instead of
 * being believed. The one table mirrored here is the gate's `LABEL_ALIASES` (incoming-gate.ts:234-250)
 * plus the GATE'S OWN `sourcePathCandidates`/`verifyFileClaim`, which are imported.
 *
 * RUN (one process, never a bare `&`):
 *   BB_LIST_FILES=1 bun run script/m14/incoming-gate.ts html html 0   > /tmp/pop-all.txt 2>&1
 *   BB_LIST_FILES=1 bun run script/m14/incoming-gate.ts html html 400 > /tmp/pop-400.txt 2>&1
 *   bun validation/m14/fixtures/html/verbatim-claim-census.ts /tmp/pop-all.txt /tmp/pop-400.txt
 */
import { existsSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { classifyEdge, externalClaimOf, sourcePathCandidates } from "../../../../script/m14/incoming-rule"

const { parseFile } = await import("../../../../src/ast/pool-worker.ts")

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ALL_LIST = process.argv[2] ?? "/tmp/html-pop-all.txt"
const SAMPLE_LIST = process.argv[3] ?? "/tmp/html-pop-400.txt"

/** Mirrors `incoming-gate.ts:234-250`. Copied deliberately and CHECKED: the closure block below
 *  compares this census's totals with the gate's printed TOTAL, so a divergence fails loudly. */
const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls",
  uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}

/** The LANE'S OWN admitted extensions (language-detection.ts's html family, the set the gate would
 *  admit under `html` when handed the family — the run under test admits `.html` only, and the
 *  distinction is printed rather than assumed). A target whose extension is in this set is a
 *  document the lane's own admitted list COULD contain; anything else cannot be admitted to this
 *  lane however the corpus is walked. */
const HTML_FAMILY_EXTS = new Set([
  "html", "htm", "xhtml", "hbs", "twig", "pug", "erb", "mustache", "ejs", "liquid", "njk", "jinja", "j2",
])

const readList = (file: string): string[] => {
  const out: string[] = []
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^BB_LIST_FILES_FILE: (.*)$/)
    if (m) out.push(m[1])
  }
  return out
}

const repoOf = (f: string): string => path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])
const relOf = (f: string): string => path.relative(repoOf(f), f).split(path.sep).join("/")

/** A scheme test that does NOT fire on a Windows drive letter — the gate's own distinction. */
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i
const NETWORK_SCHEME = /^(https?|ftp|ws|wss):/i

type Shape = "network-url" | "protocol-relative-url" | "other-scheme" | "root-relative-path" | "relative-path" | "fragment" | "bare-name"

function shapeOf(tgt: string): Shape {
  if (tgt.startsWith("//")) return "protocol-relative-url"
  if (URI_SCHEME.test(tgt)) return NETWORK_SCHEME.test(tgt) ? "network-url" : "other-scheme"
  if (tgt.startsWith("#")) return "fragment"
  if (tgt.startsWith("/")) return "root-relative-path"
  if (tgt.includes("/")) return "relative-path"
  return "bare-name"
}

const extOf = (tgt: string): string => {
  const clean = tgt.split(/[?#]/)[0]
  const base = clean.slice(clean.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase()
}

/** THE DOCUMENT-RELATIVE REBASING the brief names, plus the site-root convention. Pure string work:
 *  it does not touch the target, only proposes a path the project's file list can be asked about. */
function rebase(docRel: string, tgt: string): string[] {
  const noQuery = tgt.split(/[?#]/)[0]
  if (noQuery.length === 0) return []
  const dir = path.posix.dirname(docRel)
  if (noQuery.startsWith("/")) return [path.posix.normalize(noQuery.slice(1))].filter((p) => p !== "." && p !== "/")
  return [path.posix.normalize(path.posix.join(dir === "." ? "" : dir, noQuery))].filter((p) => p !== "." && p !== "/")
}

// ---------------------------------------------------------------------------------------------
// 1. THE PROJECT'S OWN FILE LIST — the gate's `projectFactsForFiles`, built from the UNSAMPLED
//    admitted list. This is the EVIDENCE every file claim is checked against.
// ---------------------------------------------------------------------------------------------
const admittedFiles = readList(ALL_LIST)
const admittedByRepo = new Map<string, Set<string>>()
for (const f of admittedFiles) {
  const repo = repoOf(f)
  let s = admittedByRepo.get(repo)
  if (!s) admittedByRepo.set(repo, (s = new Set()))
  s.add(relOf(f))
}
const sample = readList(SAMPLE_LIST)

// ---------------------------------------------------------------------------------------------
// 2. WALK THE SAMPLE WITH PRODUCTION'S OWN ENTRY POINT, exactly as the gate does.
// ---------------------------------------------------------------------------------------------
type Edge = {
  repo: string
  file: string
  rel: string
  type: string
  target: string
  shape: Shape
  meta: Record<string, unknown>
  markers: string
  line: number
}
const edges: Edge[] = []
const projectDecl = new Map<string, Map<string, number>>()
const projectKinds = new Map<string, Map<string, Set<string>>>()
let parsed = 0
let failed = 0

for (const f of sample) {
  let r: any
  try {
    r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any)
  } catch {
    failed++
    continue
  }
  if (!r) { failed++; continue }
  parsed++
  const repo = repoOf(f)
  let pDecl = projectDecl.get(repo)
  if (!pDecl) projectDecl.set(repo, (pDecl = new Map()))
  let pKinds = projectKinds.get(repo)
  if (!pKinds) projectKinds.set(repo, (pKinds = new Map()))
  const countKey = (key: string, kind: string) => {
    pDecl!.set(key, (pDecl!.get(key) ?? 0) + 1)
    let ks = pKinds!.get(key)
    if (!ks) pKinds!.set(key, (ks = new Set()))
    ks.add(kind)
  }
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    const kind = String(s?.kind ?? "")
    countKey(name, kind)
    const q = String(s?.qualifiedName ?? "")
    if (q.length > 0 && q !== name) countKey(q, kind)
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = LABEL_ALIASES[String(rel?.type ?? rel?.relationshipType ?? "")]
    if (!label) continue
    const target = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (target.length === 0) continue
    const md = (rel?.metadata ?? {}) as Record<string, unknown>
    // The gate's own marker-signature rule: keys with a truthy value, evidenceClass/analysisVersion
    // excluded (they are on every edge and separate nothing).
    const markers = Object.keys(md)
      .filter((k) => k !== "evidenceClass" && k !== "analysisVersion" && md[k] !== false && md[k] != null)
      .sort()
      .join("+")
    edges.push({
      repo, file: f, rel: relOf(f), type: label, target, shape: shapeOf(target), meta: md, markers,
      line: Number(rel?.line_number ?? 0),
    })
  }
}

// ---------------------------------------------------------------------------------------------
// 3. CLASSIFY EVERY EDGE WITH THE GATE'S OWN RULE over the gate's own key space + file list.
// ---------------------------------------------------------------------------------------------
const outcomeOf = new Map<Edge, string>()
for (const e of edges) {
  const facts = { packages: new Set<string>(), files: admittedByRepo.get(e.repo) ?? new Set<string>(), sdkLib: false }
  const claim = externalClaimOf({ metadata: e.meta })
  const c = classifyEdge(
    projectDecl.get(e.repo) ?? new Map(), projectKinds.get(e.repo) ?? new Map(),
    e.target, claim, facts, false,
    (projectDecl.get(e.repo) ?? new Map()).has(e.target),
  )
  outcomeOf.set(e, c.outcome)
}

const byType = new Map<string, Map<string, number>>()
for (const e of edges) {
  let m = byType.get(e.type)
  if (!m) byType.set(e.type, (m = new Map()))
  const o = outcomeOf.get(e)!
  m.set(o, (m.get(o) ?? 0) + 1)
}
const tot = (f: (o: string) => boolean) => edges.filter((e) => f(outcomeOf.get(e)!)).length
console.log(`POPULATION (the gate's own discovery): full admitted ${admittedFiles.length} · sample ${sample.length} · repos in sample ${new Set(sample.map(repoOf)).size}`)
console.log(`PARSED ${parsed} · failed ${failed} · EDGES ${edges.length}`)
console.log(`CLOSURE vs the gate's TOTAL row (gate: edges 46761 · resolved 12476 · amb 1625 · unresolved 32656):`)
console.log(`  resolved ${tot((o) => o === "resolved")} · ambBoth ${tot((o) => o === "ambBoth")} · ambDeclOnly ${tot((o) => o === "ambDeclOnly")} · unresolved ${tot((o) => o === "unresolved")} · extOK ${tot((o) => o === "externalVerified")} · ext? ${tot((o) => o === "externalUnverified")} · extFAIL ${tot((o) => o === "externalRefuted")} · causeOK ${tot((o) => o === "causeDeclared")}`)
console.log(`PER TYPE (project scope):`)
for (const [t, m] of [...byType.entries()].sort()) {
  console.log(`  ${t.padEnd(13)} ${String(edges.filter((e) => e.type === t).length).padStart(7)}  resolved ${String(m.get("resolved") ?? 0).padStart(6)}  amb ${String((m.get("ambBoth") ?? 0) + (m.get("ambDeclOnly") ?? 0)).padStart(6)}  unresolved ${String(m.get("unresolved") ?? 0).padStart(6)}`)
}

// ---------------------------------------------------------------------------------------------
// 4. THE NAMED-CAUSE BUCKETS. Named by the CONSTRUCT the analyzer emitted, read off the
//    analyzer's own metadata vocabulary — never off the fact that the edge is unresolved.
// ---------------------------------------------------------------------------------------------
function causeOf(e: Edge): string {
  const md = e.meta
  if (md.isIdref === true) return "idref: in-document reference token (references)"
  if (md.isInternalAnchor === true) return "fragment: in-document anchor (deferred, resolved)"
  if (md.isUnresolvedFragment === true) return "fragment: fetch-only carrier holding a fragment"
  if (md.isScriptUrl === true) return "javascript: URL on a resource carrier"
  if (md.htmlEmbedded === true && md.isDynamicImport === true) return "embedded JS dynamic import()"
  if (md.htmlEmbedded === true && md.isCssImport === true) return "embedded CSS @import"
  if (md.htmlEmbedded === true && md.calleeExpression != null) return "embedded JS callee (callReceiver/calleeExpression)"
  if (md.htmlEmbedded === true && md.isFieldAccess === true) return "embedded JS/CSS field access (bareRead)"
  if (md.htmlEmbedded === true) return `embedded ${String(md.embeddedLang ?? "?")} emission (no further marker)`
  if (md.isNavigation === true) return `navigation link (href/action=${String(md.resourceType ?? "?")}) written verbatim`
  if (md.isFormEndpoint === true) return `form endpoint (=${String(md.resourceType ?? "?")}) written verbatim`
  if (md.isExternalResource === true) return `network-URL fetch (=${String(md.resourceType ?? "?")}) written verbatim`
  if (md.resourceType != null) return `local fetch (=${String(md.resourceType ?? "?")}) written verbatim`
  return `(no resource/embedded marker on a ${e.type} edge)`
}

const causes = new Map<string, number>()
for (const e of edges) {
  if (outcomeOf.get(e) !== "unresolved") continue
  const k = causeOf(e)
  causes.set(k, (causes.get(k) ?? 0) + 1)
}
const unresolvedTotal = tot((o) => o === "unresolved")
console.log(`\nUNRESOLVED BY NAMED CAUSE — ${unresolvedTotal} edge(s), ${causes.size} bucket(s):`)
let sum = 0
for (const [k, n] of [...causes.entries()].sort((a, b) => b[1] - a[1])) { sum += n; console.log(`  ${String(n).padStart(7)}  ${k}`) }
console.log(`  ${String(sum).padStart(7)}  = SUM (${sum === unresolvedTotal ? "CLOSES against this census's unresolved" : "DOES NOT CLOSE"})`)

console.log(`\nUNRESOLVED BY CAUSE x SHAPE:`)
const causeShape = new Map<string, number>()
for (const e of edges) {
  if (outcomeOf.get(e) !== "unresolved") continue
  const k = `${causeOf(e)}  ||  ${e.shape}`
  causeShape.set(k, (causeShape.get(k) ?? 0) + 1)
}
for (const [k, n] of [...causeShape.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24)) console.log(`  ${String(n).padStart(7)}  ${k}`)

// ---------------------------------------------------------------------------------------------
// 5. THE CHANNEL SIMULATION. Every channel is evaluated on the SAME rule the gate will run:
//    a claim is read only at `decls === 0`; a file claim verifies on an exact admitted path OR a
//    whole-segment DIRECTORY prefix; a source-path claim verifies when NO candidate is admitted.
// ---------------------------------------------------------------------------------------------
type Sim = { verify: number; refute: number; selected: number; steals: number; samples: string[] }
const mk = (): Sim => ({ verify: 0, refute: 0, selected: 0, steals: 0, samples: [] })

/** The gate's `verifyFileClaim`, body for body. */
function fileClaim(cands: string[], files: Set<string>): "externalVerified" | "externalRefuted" {
  for (const c of cands) if (files.has(c)) return "externalVerified"
  for (const c of cands) {
    const prefix = c + "/"
    for (const f of files) if (f.startsWith(prefix)) return "externalVerified"
  }
  return "externalRefuted"
}
/** The gate's `sourcePath` branch, body for body. */
function sourceClaim(sources: string[], files: Set<string>): "externalVerified" | "externalRefuted" {
  for (const src of sources) for (const cand of sourcePathCandidates(src)) if (files.has(cand)) return "externalRefuted"
  return "externalVerified"
}
const declsOf = (e: Edge) => (projectDecl.get(e.repo) ?? new Map<string, number>()).get(e.target) ?? 0

/** Attach a channel to every unresolved edge the predicate selects and see what the gate would do. */
function simulate(name: string, pick: (e: Edge) => string[] | null): Sim {
  const s = mk()
  for (const e of edges) {
    if (outcomeOf.get(e) !== "unresolved") continue
    const payload = pick(e)
    if (payload === null) continue
    s.selected++
    const files = admittedByRepo.get(e.repo) ?? new Set<string>()
    const out = name === "sourcePath"
      ? sourceClaim(payload, files)
      : fileClaim(payload, files)
    if (declsOf(e) > 0) s.steals++
    if (out === "externalVerified") {
      s.verify++
      if (s.samples.length < 3) s.samples.push(`${e.rel}:${e.line} -> ${e.target} :: ${payload.join(" | ")}`)
    } else if (out === "externalRefuted") {
      s.refute++
      if (s.samples.length < 3) s.samples.push(`REFUTED ${e.rel}:${e.line} -> ${e.target} :: ${payload.join(" | ")}`)
    }
  }
  return s
}
/** An unresolved edge is "path-shaped" when the target carries a separator or a scheme. */
const pathShaped = (e: Edge) => e.shape !== "bare-name" && e.shape !== "fragment"
const htmlFamily = (e: Edge) => HTML_FAMILY_EXTS.has(extOf(e.target))

const channels: Array<[string, string, Sim]> = []
// A — the honest minimal write: the WRITTEN string, published on the key the gate reads, for the
//     targets the lane's own admitted list cannot contain (non-html-family).
channels.push(["A sourcePath(written) on non-html-family path targets", "sourcePath",
  simulate("sourcePath", (e) => (pathShaped(e) && !htmlFamily(e) && e.shape !== "other-scheme" && e.shape !== "fragment" ? [e.target] : null))])
// B — the same key for the html-family path targets, where a basename candidate CAN collide.
channels.push(["B sourcePath(written) on html-family path targets", "sourcePath",
  simulate("sourcePath", (e) => (pathShaped(e) && htmlFamily(e) ? [e.target] : null))])
// C — the rebasing the brief names, published as a FILE claim (the project's own file list decides).
channels.push(["C fileClaim(rebased) on ALL path targets", "file",
  simulate("file", (e) => (pathShaped(e) && e.shape !== "other-scheme" && e.shape !== "fragment" ? rebase(e.rel, e.target) : null))])
// D — the same, narrowed to the extensions this lane's admitted list could contain.
channels.push(["D fileClaim(rebased) on html-family path targets", "file",
  simulate("file", (e) => (pathShaped(e) && htmlFamily(e) ? rebase(e.rel, e.target) : null))])
// E — the same, behind an EXISTENCE PROBE: the claim is only published where the rebased file is
//     ON DISK beside the document, so a dead link cannot be claimed as a file the project admits.
//     Candidates that ESCAPE the project root (`..`) are refused too — they can never be admitted.
channels.push(["E fileClaim(rebased) on html-family targets, existence-guarded, non-escaping", "file",
  simulate("file", (e) => {
    if (!htmlFamily(e) || (!pathShaped(e) && e.shape !== "bare-name")) return null
    const cands = rebase(e.rel, e.target).filter((c) => !c.startsWith("..") && !path.posix.isAbsolute(c))
    if (cands.length === 0) return null
    if (!cands.some((c) => existsSync(path.resolve(repoOf(e.file), c)))) return null
    return cands
  })])
// F — sourcePath on everything path-shaped, the widest honest statement of "no admitted file
//     answers this written string".
channels.push(["F sourcePath(written) on ALL path targets (incl. html-family)", "sourcePath",
  simulate("sourcePath", (e) => (pathShaped(e) && e.shape !== "other-scheme" && e.shape !== "fragment" ? [e.target] : null))])
// G — THE HYBRID: the file claim where the rebased document EXISTS beside this one (a real
//     internal link the project's own file list can confirm), sourcePath everywhere else
//     path-shaped. One rule, two channels, and the choice is made from EVIDENCE (a file on disk).
{
  const s = mk()
  for (const e of edges) {
    if (outcomeOf.get(e) !== "unresolved") continue
    const files = admittedByRepo.get(e.repo) ?? new Set<string>()
    const cands = htmlFamily(e) ? rebase(e.rel, e.target).filter((c) => !c.startsWith("..") && !path.posix.isAbsolute(c)) : []
    const internal = cands.length > 0 && cands.some((c) => existsSync(path.resolve(repoOf(e.file), c)))
    let out: string | null = null
    if (internal) out = fileClaim(cands, files)
    else if (pathShaped(e) && e.shape !== "other-scheme" && e.shape !== "fragment") out = sourceClaim([e.target], files)
    if (out === null) continue
    s.selected++
    if (declsOf(e) > 0) s.steals++
    if (out === "externalVerified") {
      s.verify++
      if (internal && s.samples.length < 4) s.samples.push(`internal ${e.rel}:${e.line} -> ${e.target} :: ${cands.join(" | ")}`)
    } else if (out === "externalRefuted") {
      s.refute++
      if (s.samples.length < 4) s.samples.push(`REFUTED ${e.rel}:${e.line} -> ${e.target} :: ${internal ? cands.join(" | ") : e.target}`)
    }
  }
  channels.push(["G HYBRID: fileClaim(rebased, existence-guarded) for documents, sourcePath otherwise", "mixed", s])
}
// H — WHY does the unguarded file claim refute? Separates a DEAD LINK (nothing on disk) from an
//     EXISTS-BUT-NOT-ADMITTED file (untracked / over the size cap), because the second is the
//     only case the existence guard cannot remove. Measured over EVERY html-family path-shaped
//     edge, not only the unresolved ones, so the number is the same before and after any fix that
//     adds metadata without moving a target.
{
  let considered = 0, refuted = 0, dead = 0, existsNotAdmitted = 0, escaping = 0, wouldVerify = 0
  const samples: string[] = []
  for (const e of edges) {
    if ((!pathShaped(e) && e.shape !== "bare-name") || !htmlFamily(e)) continue
    considered++
    const all = rebase(e.rel, e.target)
    const cands = all.filter((c) => !c.startsWith("..") && !path.posix.isAbsolute(c))
    if (cands.length < all.length) escaping++
    const files = admittedByRepo.get(e.repo) ?? new Set<string>()
    const out = fileClaim(cands, files)
    if (out === "externalVerified") { wouldVerify++; continue }
    refuted++
    const on = cands.some((c) => existsSync(path.resolve(repoOf(e.file), c)))
    if (on) { existsNotAdmitted++; if (samples.length < 3) samples.push(`EXISTS-NOT-ADMITTED ${e.rel}:${e.line} -> ${e.target} :: ${cands.join(" | ")}`) }
    else { dead++; if (samples.length < 3) samples.push(`DEAD ${e.rel}:${e.line} -> ${e.target} :: ${cands.join(" | ")}`) }
  }
  console.log(`\nH — THE UNGUARDED FILE CLAIM over EVERY html-family path-shaped/bare edge (${considered}): ${wouldVerify} verify · ${refuted} refute = ${dead} DEAD (nothing on disk) + ${existsNotAdmitted} EXISTS-BUT-NOT-ADMITTED · ${escaping} target(s) escape the project root`)
  console.log(`    So the existence guard removes ${dead} of ${refuted} refutation(s); ${existsNotAdmitted} would survive it.`)
  for (const x of samples) console.log(`    e.g. ${x}`)
}

console.log(`\nCHANNEL SIMULATION over the ${unresolvedTotal} unresolved edge(s) — "steals" is a claim read on a target that ALREADY has a declaration (must be 0):`)
for (const [label, kind, s] of channels) {
  console.log(`  ${label}\n      kind=${kind}  SELECTED ${s.selected}  VERIFIES ${s.verify}  REFUTES ${s.refute}  stays-unresolved ${unresolvedTotal - s.verify - s.refute}  STEALS-RESOLUTION ${s.steals}`)
  for (const x of s.samples) console.log(`        e.g. ${x}`)
}

// ---------------------------------------------------------------------------------------------
// 6. THE SHAPE OF WHAT A REBASE WOULD NAME — measured, because the whole design turns on it.
// ---------------------------------------------------------------------------------------------
console.log(`\nPATH-TARGET SHAPE (unresolved, path-shaped):`)
const shapeCounts = new Map<string, number>()
for (const e of edges) {
  if (outcomeOf.get(e) !== "unresolved" || !pathShaped(e)) continue
  const k = `${e.shape}  ext=${extOf(e.target) || "(none)"}  htmlFamily=${htmlFamily(e)}`
  shapeCounts.set(k, (shapeCounts.get(k) ?? 0) + 1)
}
for (const [k, n] of [...shapeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(n).padStart(7)}  ${k}`)

// The network-URL class, counted separately: its scheme is what makes it external by construction.
let netUrls = 0
for (const e of edges) if (outcomeOf.get(e) === "unresolved" && (e.shape === "network-url" || e.shape === "protocol-relative-url")) netUrls++
console.log(`  of which NETWORK URLs (scheme http/https/ws/ftp or protocol-relative): ${netUrls}`)
console.log(`  of which HTML-FAMILY extension anywhere: ${edges.filter((e) => outcomeOf.get(e) === "unresolved" && pathShaped(e) && htmlFamily(e)).length}`)
