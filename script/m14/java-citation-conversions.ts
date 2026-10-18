/**
 * JAVA LANE — the CITATION-CONVERSION DECOMPOSITION (task-17 follow-up, read-only).
 *
 * The Lead reproduced the library-namespace citation emission on arm A: ext? 2,446 → 0 and
 * extOK +4,091, with resolved −468, amb −195, unresolved −982 (the four losses sum exactly to
 * the gain: the arbiter's namespace claim is the SOLE AUTHORITY for its rows, so it converts
 * from every other class). This instrument decomposes that movement from the PRE-citation
 * dump + the corpus's own file facts, so each converted row class is named rather than inferred:
 *
 *   CLAIMABLE-DOTTED     target's leading segments name a registry root (`jakarta…`)
 *   CLAIMABLE-BARE       bare target whose SINGLE-TYPE import is under a registry root
 *   SHADOWED-BARE        …but the FILE itself declares that name (a nested/member type shadows
 *                        the import, JLS 6.4.1) — these must NOT be claimed; they are the
 *                        candidate "true project references" the Lead asked about
 *   PATH-LIKE-RESERVED   the 243 reserved-prefix rows the Lead's instrument now cites
 *
 * For the RESOLVED withdrawals (not present in the dump — the dump is non-resolved rows only)
 * it prices the candidate set: (file, bare name) pairs whose single-type import is under a
 * registry root AND whose name the corpus declares exactly once — exactly the shape the name
 * model resolves and the citation withdraws.
 *
 * CLI: bun run script/m14/java-citation-conversions.ts <pre-citation-dump> [--json]
 * EXIT 0 measured · 2 usage/missing corpus
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"

const argv = process.argv.slice(2)
const dumpPath = argv.find((a) => !a.startsWith("--"))
const asJson = argv.includes("--json")
if (!dumpPath) {
  console.error("usage: java-citation-conversions.ts <pre-citation-dump> [--json]")
  process.exit(2)
}
const CORPUS = process.env.BB_CORPUS_ROOT ?? path.resolve(".corpus")
const REGISTRY = ["jakarta", "androidx", "dotty.tools", "org.yaml"]

type FileFacts = {
  singleImports: Map<string, string> // leaf -> module path
  declaredNames: Set<string>         // every type name the file declares (nested included)
  packageName: string
}
const factsCache = new Map<string, FileFacts>()
const parser = await getParser("java" as any)
const TYPE_DECL = new Set(["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"])

function factsFor(absPath: string): FileFacts | null {
  const hit = factsCache.get(absPath)
  if (hit) return hit
  let tree: any
  try { tree = parser.parse(readFileSync(absPath, "utf8")) } catch { return null }
  const facts: FileFacts = { singleImports: new Map(), declaredNames: new Set(), packageName: "" }
  const walk = (n: any): void => {
    if (!n) return
    if (TYPE_DECL.has(n.type)) {
      const nm = n.childForFieldName?.("name")?.text
      if (nm) facts.declaredNames.add(nm)
    } else if (n.type === "package_declaration") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && (c.type === "scoped_identifier" || c.type === "identifier")) { facts.packageName = c.text; break }
      }
    } else if (n.type === "import_declaration") {
      let isStatic = false
      for (let i = 0; i < n.childCount; i++) if (n.child(i)?.type === "static") isStatic = true
      let wild = false
      for (let i = 0; i < n.namedChildCount; i++) if (n.namedChild(i)?.type === "asterisk") wild = true
      if (!isStatic && !wild) {
        let mod = ""
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && (c.type === "scoped_identifier" || c.type === "identifier")) { mod = c.text; break }
        }
        const leaf = mod.slice(mod.lastIndexOf(".") + 1)
        if (leaf) facts.singleImports.set(leaf, mod)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(tree.rootNode)
  factsCache.set(absPath, facts)
  return facts
}

function registryRootOf(name: string): string | null {
  for (const root of [...REGISTRY].sort((a, b) => b.length - a.length)) {
    if (name === root || name.startsWith(`${root}.`)) return root
  }
  return null
}

/** Does the PROJECT (the row's own corpus repo) declare the FQN spelled by `qualified`?
 *  The analyzer's projectIndex aliases every declared type with its file-path suffixes
 *  (`qualifyTypeWithFile`), so ownership is testable as a PATH SUFFIX: a declaring file of the
 *  leaf whose path ends with the dotted path as directories. Per repo, because the analyzer's
 *  index is built per project (per corpus repository). */
function projectOwnsQualified(repo: string, qualified: string, leaf: string): boolean {
  const suffix = "/" + qualified.replace(/\./g, "/") + ".java"
  for (const decl of declFiles.get(leaf) ?? []) {
    if (repoOfPath(decl) !== repo) continue
    if (decl.endsWith(suffix)) return true
  }
  return false
}

// ---- the corpus-wide declaration census (for the resolved-withdrawal candidate set) ----
const declCount = new Map<string, number>()
const declFiles = new Map<string, string[]>()
/** repo (first path segment under .corpus) -> declared type-name counts — the analyzer's
 *  projectIndex is built PER PROJECT (per corpus repository), so project ownership must be
 *  tested per repo, not corpus-wide. */
const repoDeclCount = new Map<string, Map<string, number>>()
const repoOfPath = (p: string): string => {
  const marker = "/.corpus/"
  const i = p.indexOf(marker)
  if (i < 0) return ""
  const rest = p.slice(i + marker.length)
  return rest.split("/")[0] ?? ""
}
function walkCorpus(dir: string): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const d = stack.pop()!
    let entries: import("node:fs").Dirent[]
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const abs = path.join(d, e.name)
      // THE CORPUS REPOS ARE SYMLINKS. `Dirent.isDirectory()` is FALSE for a symlink, so the
      // first version walked 3 files instead of the whole corpus — the sql lane paid for this
      // exact defect once (a symlinked repository dropped from its census), so the test follows
      // the link: statSync, not Dirent.
      let isDir = e.isDirectory()
      if (!isDir && e.isSymbolicLink()) {
        try { isDir = statSync(abs).isDirectory() } catch { isDir = false }
      }
      if (isDir) stack.push(abs)
      else if (e.name.endsWith(".java")) out.push(abs)
    }
  }
  return out
}
const files = walkCorpus(CORPUS)
for (const f of files) {
  const facts = factsFor(f)
  if (!facts) continue
  const repo = repoOfPath(f)
  const repoCounts = repoDeclCount.get(repo) ?? new Map<string, number>()
  for (const n of facts.declaredNames) {
    declCount.set(n, (declCount.get(n) ?? 0) + 1)
    const list = declFiles.get(n) ?? []
    if (list.length < 5) list.push(f)
    declFiles.set(n, list)
    repoCounts.set(n, (repoCounts.get(n) ?? 0) + 1)
  }
  repoDeclCount.set(repo, repoCounts)
}

// ---- the dump decomposition ----
type Row = { label: string; outcome: string; target: string; file: string; line: number }
const rows: Row[] = []
for (const raw of readFileSync(dumpPath, "utf8").split("\n")) {
  if (!raw.startsWith("DUMP\t")) continue
  const p = raw.split("\t")
  if (p.length < 6) continue
  const loc = p[4]
  const colon = loc.lastIndexOf(":")
  rows.push({ label: p[1], outcome: p[2], target: p[3], file: colon > 0 ? loc.slice(0, colon) : loc, line: colon > 0 ? Number(loc.slice(colon + 1)) || 0 : 0 })
}

type Tally = { outcome: string; label: string; kind: string; count: number }
const tally = new Map<string, number>()
const samples = new Map<string, string[]>()
const bump = (outcome: string, label: string, kind: string, row: Row) => {
  const key = `${outcome}\u0000${label}\u0000${kind}`
  tally.set(key, (tally.get(key) ?? 0) + 1)
  const list = samples.get(key) ?? []
  if (list.length < 3) list.push(`${row.target} @ ${row.file.split("/.corpus/").pop()}:${row.line}`)
  samples.set(key, list)
}
let unresolvedFile = 0
for (const row of rows) {
  if (row.outcome !== "externalUnverified" && row.outcome !== "resolved" && row.outcome !== "ambDeclOnly" && row.outcome !== "ambBoth" && row.outcome !== "unresolved") continue
  const facts = factsFor(row.file)
  if (!facts) { unresolvedFile++; continue }
  const target = row.target
  // (a) the Lead's path-like reserved class: reserved-prefixed target the verifier now cites
  const reserved = ["java.", "javax.", "jdk.", "sun.", "com.sun."]
  if (reserved.some((ns) => target.startsWith(ns))) { bump(row.outcome, row.label, "path-like-reserved", row); continue }
  // (b) dotted target under a registry root
  const dottedRoot = registryRootOf(target)
  if (dottedRoot !== null) { bump(row.outcome, row.label, `claimable-dotted:${dottedRoot}`, row); continue }
  // (c) bare target whose single-type import is under a registry root
  // (d) anything else that was ext? is a row the citation does NOT explain — print it, never drop it
  if (!target.includes(".")) {
    const imported = facts.singleImports.get(target)
    if (imported && registryRootOf(imported) !== null) {
      const root = registryRootOf(imported)!
      if (facts.declaredNames.has(target)) bump(row.outcome, row.label, `shadowed-bare(MUST-NOT-CLAIM):${root}`, row)
      else bump(row.outcome, row.label, `claimable-bare:${root}`, row)
      continue
    }
  }
  if (row.outcome === "externalUnverified") bump(row.outcome, row.label, "UNCLASSIFIED", row)
}

// ---- resolved-withdrawal candidate pricing ----
// A name model resolves a bare target when the corpus declares it exactly once; those rows are
// absent from the non-resolved dump, so the candidates are priced from the files themselves.
let resolvedCandidates = 0
let candidateInternal = 0
const candidateRoots = new Map<string, number>()
const resolvedSamples: string[] = []
for (const f of files) {
  const facts = factsFor(f)
  if (!facts) continue
  for (const [leaf, mod] of facts.singleImports) {
    if (registryRootOf(mod) === null) continue
    if (facts.declaredNames.has(leaf)) continue
    if ((declCount.get(leaf) ?? 0) !== 1) continue
    resolvedCandidates++
    const root = registryRootOf(mod)!
    candidateRoots.set(root, (candidateRoots.get(root) ?? 0) + 1)
    const decl = declFiles.get(leaf)?.[0] ?? "?"
    // project-internal = the declaring file lives under the same corpus repository as the importer
    const repoOf = (p: string): string => p.split("/.corpus/").pop()!.split("/")[0]
    const importedPath = mod
    const qualifiedOwned = projectOwnsQualified(repoOf(f), importedPath, leaf)
    if (qualifiedOwned) candidateInternal++
    if (resolvedSamples.length < 8) {
      const samePackage = factsFor(decl)?.packageName === facts.packageName
      resolvedSamples.push(`${qualifiedOwned ? "PROJECT-OWNS-FQN(over-claim)" : "external-citation(legit)"} ${leaf} from ${mod} @ ${f.split("/.corpus/").pop()} ; declared at ${decl.split("/.corpus/").pop()} (root=${root}, samePackage=${samePackage})`)
    }
  }
}

// ---- NARROWING PREDICTION (the Lead's question 2) ----
// The analyzer's project index IS the project's own key space. A citation must not claim a
// target the project itself declares (the arbiter's own discipline: a project declaration
// answers the target, so the edge is not external). Predicted here per row from the per-repo
// declaration census: `repoDeclCount(repo).has(leaf)` is the analyzer's `symbolNames.has(leaf)`.
let narrowKept = 0
let narrowDropped = 0
const narrowKeptByClass = new Map<string, number>()
const narrowDroppedByClass = new Map<string, number>()
const narrowDroppedSamples: string[] = []
for (const g of [...tally.entries()]) {
  if (g[0].startsWith("shadowed") || g[0].includes("UNCLASSIFIED")) continue
}
for (const row of rows) {
  // only the conversion-relevant classes: rows already extOK by another claim are not part of
  // this movement (their column does not change), and resolved rows are not in the dump.
  if (row.outcome !== "externalUnverified" && row.outcome !== "ambDeclOnly" && row.outcome !== "ambBoth" && row.outcome !== "unresolved") continue
  const facts = factsFor(row.file)
  if (!facts) continue
  const target = row.target
  const reserved = ["java.", "javax.", "jdk.", "sun.", "com.sun."]
  if (reserved.some((ns) => target.startsWith(ns))) continue
  const rootOfDotted = registryRootOf(target)
  let claimable = false
  let leaf = target
  if (rootOfDotted !== null) { claimable = true; leaf = target.slice(target.lastIndexOf(".") + 1) }
  else if (!target.includes(".")) {
    const imported = facts.singleImports.get(target)
    if (imported && registryRootOf(imported) !== null && !facts.declaredNames.has(target)) { claimable = true; leaf = target }
  }
  if (!claimable) continue
  const repo = repoOfPath(row.file)
  const imported = !target.includes(".") ? (facts.singleImports.get(target) ?? "") : ""
  const ownsQualified = projectOwnsQualified(repo, imported || target, leaf)
  const kind = rootOfDotted !== null ? `dotted:${rootOfDotted}` : `bare:${registryRootOf(imported)}`
  if (ownsQualified) {
    narrowDropped++
    narrowDroppedByClass.set(kind, (narrowDroppedByClass.get(kind) ?? 0) + 1)
    if (narrowDroppedSamples.length < 6) narrowDroppedSamples.push(`${row.outcome} ${row.label} ${target} @ ${row.file.split("/.corpus/").pop()} (PROJECT DECLARES this FQN)`)
  } else {
    narrowKept++
    narrowKeptByClass.set(kind, (narrowKeptByClass.get(kind) ?? 0) + 1)
  }
}

const groups = [...tally.entries()].map(([k, count]) => {
  const [outcome, label, kind] = k.split("\u0000")
  return { outcome, label, kind, count, sample: samples.get(k) ?? [] }
}).sort((a, b) => b.count - a.count)

const out = {
  dump: dumpPath,
  corpusFiles: files.length,
  dumpRowsConsidered: rows.length,
  unreadableFiles: unresolvedFile,
  claimableByOutcome: groups,
  resolvedWithdrawalCandidates: resolvedCandidates,
  resolvedWithdrawalProjectInternal: candidateInternal,
  resolvedWithdrawalByRoot: Object.fromEntries(candidateRoots),
  resolvedWithdrawalSamples: resolvedSamples,
  narrowingPrediction: {
    claimableRowsKept: narrowKept,
    claimableRowsDropped: narrowDropped,
    keptByClass: Object.fromEntries(narrowKeptByClass),
    droppedByClass: Object.fromEntries(narrowDroppedByClass),
    droppedSamples: narrowDroppedSamples,
  },
}
if (asJson) console.log(JSON.stringify(out, null, 2))
else {
  console.log(`corpus files: ${files.length} · dump rows: ${rows.length} · unreadable: ${unresolvedFile}`)
  console.log(`resolved-withdrawal candidates priced from files: ${resolvedCandidates} (project-internal: ${candidateInternal}, by root: ${JSON.stringify(Object.fromEntries(candidateRoots))})`)
  for (const s of resolvedSamples) console.log("  candidate:", s)
  console.log("")
  console.log(`NARROWING PREDICTION (project-owns-leaf drop): kept ${narrowKept} · dropped ${narrowDropped}`)
  console.log(`  kept by class:    ${JSON.stringify(Object.fromEntries(narrowKeptByClass))}`)
  console.log(`  dropped by class: ${JSON.stringify(Object.fromEntries(narrowDroppedByClass))}`)
  for (const s of narrowDroppedSamples) console.log("  dropped:", s)
  console.log("")
  for (const g of groups.slice(0, 24)) console.log(`${g.outcome.padEnd(18)} ${g.label.padEnd(11)} ${g.kind.padEnd(30)} ${String(g.count).padStart(7)}`)
}
