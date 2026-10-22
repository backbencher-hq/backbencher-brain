#!/usr/bin/env bun
/**
 * SCALA CONSTRUCT CENSUS — the CORPUS half of the four EXTENDED values and of `implements`.
 *
 * WHY THIS FILE EXISTS. The all-out-of-all bar (LANE-BRIEF §1) lets a type leave a lane's
 * denominator only with a CITED ruling, and a ruling needs BOTH halves (L-2026-10-21-05/06):
 *
 *   1. THE GRAMMAR-SIDE HALF — "the LANGUAGE has no such construct", measured over the pinned
 *      grammar's own node-type inventory. That is `script/m14/scala-grammar-inventory.ts`, and its
 *      artefact is `validation/m14/measurements/scala-grammar-inventory.json`.
 *   2. THE CORPUS-SIDE HALF — "and the population carries none of it, and here is the NEAR MISS,
 *      NAMED AND COUNTED" (the NEAR-MISS TEST). A near-miss construct that is not named and counted
 *      makes the absence prose.
 *
 * ⇒ THIS FILE IS THE CORPUS HALF, and it is a CONSTRUCT census: it walks the pinned grammar's node
 *   types over REAL corpus files. It does NOT call the analyzer, so it cannot be light or degraded
 *   by an analyzer that fails to build its own parser (L-2026-10-21-10) — the analyzer-side counts
 *   are the ARM's to produce, and this file says so rather than pretending to know them.
 *
 * THE POPULATION, BY THE FLEET'S OWN RULE — three denominators, never mixed:
 *   PATHS          · the git-tracked paths under the corpus root
 *   DISTINCT FILES · the same, de-duplicated (one path = one file here; the count is printed)
 *   ADMITTED       · the git-tracked set UNDER THE 1 MB SIZE CAP — and THIS is the population
 *                    every count in this file is over. The over-cap files are COUNTED and reported
 *                    so the difference between PATHS and ADMITTED is visible, never assumed.
 *   REPO COUNT     · repositories CARRYING an admitted file (a cell's repo count).
 *   The corpus root is `$PWD/.corpus` — 199 absolute symlinks into the repository store plus local
 *   checkouts. ★ SYMLINKED DIRECTORIES ARE FOLLOWED, and the walk PRINTS HOW MANY IT FOLLOWED:
 *   `readdirSync(..., {withFileTypes:true}).isDirectory()` is FALSE for a symlink and silently
 *   drops whole repos, so the count is a fact, not a claim.
 *
 * Usage: bun run script/m14/scala-construct-census.ts [--max=<files>] [--json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, statSync, lstatSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"
import { createHash } from "node:crypto"

const ROOT = resolve(import.meta.dirname, "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ? resolve(process.env.BB_CORPUS_ROOT) : resolve(ROOT, ".corpus")
const OUT_DIR = join(ROOT, "validation", "m14", "measurements")
const OUT_PATH = join(OUT_DIR, "scala-construct-census.json")
const argv = process.argv.slice(2)
const argOf = (n: string, d: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const MAX = Number(argOf("max", "0")) // 0 = every admitted file

const EXTS = [".scala", ".sc", ".sbt"]
const SIZE_CAP = 1024 * 1024

/** THE CONSTRUCTS THIS CENSUS COUNTS — one row per type the lane must disposition. */
type Row = { sites: number; files: number; note: string }
const rows: Record<string, Row> = {}
const bump = (k: string, file: string): void => {
  if (!rows[k]) rows[k] = { sites: 0, files: 0, note: "" }
  rows[k].sites++
}
/** PER-FILE presence, so `files` counts files carrying at least one site. */
const perFile: Record<string, Set<string>> = {}
const markFile = (k: string, file: string): void => {
  if (!perFile[k]) perFile[k] = new Set()
  perFile[k].add(file)
}

/** THE SELF-TYPE TARGETS — the `implements` candidate's shape, counted. */
const selfTypeTargets = new Map<string, number>()
/** THE EXTENDS-CLAUSE SHAPES — how many supertypes each clause carries (the `mixes_in` split). */
const extendsShapes = new Map<string, number>()
/** THE SELF-TYPE'S REQUIRED-TYPE SHAPES — the `implements` disposition's second half. */
const selfTypeRequiredShapes = new Map<string, number>()

// ─────────────────────────────────────────────────────────────── the population
console.log(`SCALA CONSTRUCT CENSUS`)
console.log(`corpus root: ${CORPUS}`)

let repos: string[] = []
try {
  repos = readdirSync(CORPUS, { withFileTypes: true })
    .map((d) => d.name)
    .filter((n) => !n.startsWith("."))
    .sort()
} catch (e) {
  console.error(`FAIL: cannot read the corpus root ${CORPUS} — ${String(e).slice(0, 120)}`)
  process.exit(5)
}

// ★ THE SYMLINK FOLLOW. Each corpus entry is an absolute symlink into the repository store, so
//   `isDirectory()` on the LINK is false; the test must be on the TARGET. The count is printed.
let symlinkedDirsFollowed = 0
const repoDirs: Array<{ name: string; dir: string; isSymlink: boolean }> = []
for (const name of repos) {
  const p = join(CORPUS, name)
  let isSymlink = false
  try { isSymlink = lstatSync(p).isSymbolicLink() } catch { continue }
  let isDir = false
  try { isDir = statSync(p).isDirectory() } catch { continue }
  if (!isDir) continue
  if (isSymlink) symlinkedDirsFollowed++
  repoDirs.push({ name, dir: p, isSymlink })
}
console.log(`corpus entries: ${repos.length} · directories (symlinks FOLLOWED): ${repoDirs.length} · of those SYMLINKED: ${symlinkedDirsFollowed}`)

type RepoFile = { abs: string; repo: string; rel: string }
const admitted: RepoFile[] = []
const overCap: Array<{ abs: string; repo: string; bytes: number }> = []
const notGit: string[] = []
let trackedPaths = 0
for (const r of repoDirs) {
  let tracked: string[] = []
  try {
    execFileSync("git", ["-C", r.dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    notGit.push(r.name)
    continue
  }
  try {
    tracked = execFileSync("git", ["-C", r.dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    notGit.push(r.name)
    continue
  }
  for (const rel of tracked) {
    if (!EXTS.some((x) => rel.toLowerCase().endsWith(x))) continue
    trackedPaths++
    const abs = join(r.dir, rel)
    let bytes = 0
    try { bytes = readFileSync(abs).length } catch { continue }
    if (bytes > SIZE_CAP) { overCap.push({ abs, repo: r.name, bytes }); continue }
    admitted.push({ abs, repo: r.name, rel })
  }
}
const distinctFiles = new Set(admitted.map((a) => a.abs)).size
const repoCount = new Set(admitted.map((a) => a.repo)).size
console.log(`PATHS (git-tracked .scala/.sc/.sbt)  ${trackedPaths}`)
console.log(`DISTINCT FILES                       ${distinctFiles}`)
console.log(`ADMITTED (tracked AND <= 1 MB)       ${admitted.length}   (${overCap.length} over the cap, excluded)`)
console.log(`REPO COUNT (repos carrying one)      ${repoCount}`)
const perRepo: Record<string, number> = {}
for (const a of admitted) perRepo[a.repo] = (perRepo[a.repo] ?? 0) + 1
console.log(`per repo: ${Object.entries(perRepo).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`)
if (notGit.length) console.log(`not a git checkout (skipped): ${notGit.join(", ")}`)

const files = (MAX > 0 ? admitted.slice(0, MAX) : admitted).map((a) => a.abs)

// ─────────────────────────────────────────────────────────────── the walk
const { getParser } = await import(resolve(ROOT, "src/ast/engine"))
const { resolveWasmAsset, hasWasmInRegistry } = await import(resolve(ROOT, "src/util/wasm"))
const SPELLING = "tree-sitter-scala.wasm"
const bytes = hasWasmInRegistry(SPELLING)
const grammarSha = bytes && bytes.length ? createHash("sha256").update(bytes).digest("hex") : null
const parser = await getParser("scala" as any)

let parsed = 0, failed = 0, errorNodes = 0, filesWithError = 0
let bytesRead = 0

for (const f of files) {
  let src: string
  try { src = readFileSync(f, "utf8") } catch { continue }
  bytesRead += Buffer.byteLength(src, "utf8")
  let tree: any
  try { tree = parser.parse(src) } catch { failed++; continue }
  parsed++
  const stack: any[] = [tree.rootNode]
  let fileHasError = false
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    const t = n.type
    if (t === "ERROR" || t === "error_sentinel") { errorNodes++; fileHasError = true }
    switch (t) {
      case "self_type": {
        bump("self_type", f); markFile("self_type", f)
        // THE TARGET: the self-type's LAST named child is the type it REQUIRES.
        const last = n.namedChildCount > 0 ? n.namedChild(n.namedChildCount - 1) : null
        const txt = last ? last.text.replace(/\s+/g, " ") : "(no named child)"
        selfTypeTargets.set(txt, (selfTypeTargets.get(txt) ?? 0) + 1)
        // ★ THE SHAPE SPLIT — the half that decides the `implements` disposition. A self type
        //   spells `<self-name> [":" <type>] "=>"`. WITHOUT a ":" it binds a NAME and requires
        //   nothing (not a conformance); WITH a ":" it declares a conformance requirement
        //   (the `implements` row). The split is measured over the WHOLE admitted population,
        //   not over a sample, because the ratio between the two halves IS the disposition.
        let colon = -1
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && !c.isNamed && c.type === ":") { colon = i; break }
        }
        if (colon < 0) {
          bump("self_type_name_only", f); markFile("self_type_name_only", f)
        } else {
          bump("self_type_with_required_type", f); markFile("self_type_with_required_type", f)
          let reqType = "(none)"
          for (let i = colon + 1; i < n.childCount; i++) {
            const c = n.child(i)
            if (!c || !c.isNamed) continue
            if (c.type === "block_comment" || c.type === "comment") continue
            reqType = c.type
            break
          }
          selfTypeRequiredShapes.set(reqType, (selfTypeRequiredShapes.get(reqType) ?? 0) + 1)
        }
        break
      }
      case "annotation": bump("annotation", f); markFile("annotation", f); break
      case "annotated_type": bump("annotated_type", f); markFile("annotated_type", f); break
      case "xml_element": bump("xml_element", f); markFile("xml_element", f); break
      case "xml_expression": bump("xml_expression", f); markFile("xml_expression", f); break
      case "package_object": bump("package_object", f); markFile("package_object", f); break
      case "export_declaration": bump("export_declaration", f); markFile("export_declaration", f); break
      case "extension_definition": bump("extension_definition", f); markFile("extension_definition", f); break
      case "with_template_body": bump("with_template_body", f); markFile("with_template_body", f); break
      case "uses_clause": bump("uses_clause", f); markFile("uses_clause", f); break
      case "using_directive": bump("using_directive", f); markFile("using_directive", f); break
      case "derives_clause": bump("derives_clause", f); markFile("derives_clause", f); break
      case "context_bound": bump("context_bound", f); markFile("context_bound", f); break
      case "refinement": bump("refinement", f); markFile("refinement", f); break
      case "structural_type": bump("structural_type", f); markFile("structural_type", f); break
      case "extends_clause": {
        bump("extends_clause", f); markFile("extends_clause", f)
        // THE SHAPE: how many SUPERTYPES the clause carries — 1 = extends, >=2 = the mixin list.
        const n2 = n.namedChildCount
        const key = n2 === 1 ? "1 supertype" : `${n2} supertypes`
        extendsShapes.set(key, (extendsShapes.get(key) ?? 0) + 1)
        if (n2 >= 2) { bump("extends_clause_multi", f); markFile("extends_clause_multi", f) }
        break
      }
      case "class_definition":
      case "trait_definition":
      case "object_definition":
      case "enum_definition": bump(`decl_${t}`, f); markFile(`decl_${t}`, f); break
    }
    for (const c of (n.namedChildren ?? [])) if (c) stack.push(c)
  }
  if (fileHasError) filesWithError++
  // ★ THE MEMORY DISCIPLINE: `tree.delete()` IS WHAT KEEPS THE MEMORY FLAT over a population of this
  //   size (the shared parse-lifetime instrument measures it with a control). A census that keeps
  //   the trees is a census that OOMs and reports a partial population.
  try { tree.delete() } catch { /* the census's own tree */ }
}

for (const k of Object.keys(rows)) rows[k].files = perFile[k]?.size ?? 0

console.log("")
console.log(`files parsed ${parsed} · parse failures ${failed} · ERROR nodes ${errorNodes} in ${filesWithError} files · bytes ${bytesRead}`)
console.log(`grammar: sha256 ${grammarSha} · ${resolveWasmAsset(SPELLING)}`)
console.log("")
console.log(`CONSTRUCT SITES (the CORPUS half)`)
for (const k of Object.keys(rows).sort()) {
  console.log(`  ${k.padEnd(26)} sites ${String(rows[k].sites).padStart(7)}   files ${String(rows[k].files).padStart(6)}`)
}
console.log("")
console.log(`THE extends_clause SHAPE SPLIT (pos0 = extends, pos>=1 = the mixin list)`)
for (const [k, v] of [...extendsShapes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(7)}  ${k}`)
console.log("")
console.log(`THE self_type REQUIRED-TYPE SHAPES (the \`implements\` disposition's second half)`)
for (const [k, v] of [...selfTypeRequiredShapes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`)
console.log("")
console.log(`THE self_type TARGETS (the \`implements\` candidate's shape, counted)`)
if (selfTypeTargets.size === 0) console.log(`  (none)`)
for (const [k, v] of [...selfTypeTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${String(v).padStart(6)}  ${k}`)

const report = {
  lane: "scala",
  generatedAt: new Date().toISOString(),
  corpusRoot: CORPUS,
  grammar: { spelling: SPELLING, registrySha256: grammarSha, resolvedPath: resolveWasmAsset(SPELLING) },
  population: {
    rule: "PATHS · DISTINCT FILES · ADMITTED — ADMITTED is the git-tracked set under the 1 MB size cap",
    paths: trackedPaths,
    distinctFiles,
    admitted: admitted.length,
    overCapFiles: overCap.length,
    overCap: overCap.map((o) => ({ repo: o.repo, path: o.abs.replace(CORPUS + "/", ""), bytes: o.bytes })),
    repoCount,
    perRepo,
    symlinkedDirsFollowed,
    corpusEntries: repos.length,
  },
  walked: { files: files.length, cap: MAX || null, parsed, failed, errorNodes, filesWithError, bytesRead },
  constructSites: rows,
  extendsClauseShapes: Object.fromEntries(extendsShapes),
  selfTypeRequiredShapes: Object.fromEntries([...selfTypeRequiredShapes.entries()].sort((a, b) => b[1] - a[1])),
  selfTypeTargets: Object.fromEntries([...selfTypeTargets.entries()].sort((a, b) => b[1] - a[1])),
  note:
    "THIS IS THE CONSTRUCT (GRAMMAR) SIDE. It carries no analyzer-side count: the analyzer-side per-type " +
    "emission counts are the ARM's to produce, through the production path (pool-worker.parseFile). A census " +
    "that calls analyze() directly can measure a SILENTLY DEGRADED analyzer (L-2026-10-21-10), so this file " +
    "does not call it.",
}
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(report, null, 1))
console.log("")
console.log(`written ${OUT_PATH.replace(ROOT + "/", "")}`)
process.exit(0)
