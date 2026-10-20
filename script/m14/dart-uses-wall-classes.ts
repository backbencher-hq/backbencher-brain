/**
 * dart-uses-wall-classes — WHAT THE `uses` UNRESOLVED ARM IS ACTUALLY MADE OF, AND THE ANSWER TO
 * THE RECEIVER-WALL QUESTION THE CHARTER PUTS TO typescript, javascript AND dart TOGETHER.
 *
 * ## THE QUESTION
 *
 * typescript's finding: "`metadata.owner` is stated by 12 syntactic evidence classes, all
 * FILE-LOCAL (the receiver's type must be written in the same file), and the uncarried 94% are
 * member calls whose receiver's type is not stated anywhere in the file."
 * javascript's finding: typed-receiver-member 122,877.
 * dart's `uses` unresolved arm: **16,395 rows on proxicall** (flag-on).
 *
 * All three say the same thing: **the type is DECLARED, the SITE does not say WHICH.** The charter
 * asks whether a static evidence class exists that names a receiver's type at a site WITHOUT an
 * annotation, and what population it would carry.
 *
 * ## THE CLASSIFICATION, AND WHY IT IS NOT A NAME-SHAPE GUESS
 *
 * The first version of this instrument classified by the TARGET'S SPELLING (lowercase → a local),
 * and that was WRONG in a way worth recording: `bodySmall 304`, `onSurfaceVariant 360`, `mounted
 * 274` and `seconds 235` are all lowercase and all Flutter SDK MEMBERS, not locals. **A name's
 * shape says nothing about what kind of thing it is.**
 *
 * So the classification is made from the ANALYZER'S OWN OUTPUT for the same file, which is the
 * only evidence that can answer "is this name bound HERE":
 *
 *   **W1 — THE FILE BINDS THE NAME.** The analyzer published a BINDING-SPELLED row for that name
 *        in that file (`<callable>\u0000<binding>`), which is the family's own spelling for a
 *        local read. So the name IS a local of the file, and the unresolved row is a read of a
 *        LOCAL published WITHOUT the binding spelling. **That is a SHAPE question, not a receiver
 *        wall** — the receiver wall is about a MEMBER of some type, and this is not one.
 *
 *   **W2 — THE PROJECT DECLARES IT AS A MEMBER.** The file does not bind it, and the project's own
 *        key space declares the name as a member of some type. So it is a MEMBER READ of a type the
 *        project declares, and the site does not say which type. **THIS IS THE CLASS typescript and
 *        javascript reached independently.** The evidence that would settle it is the receiver's
 *        static type at the site — and the project's key space cannot supply that, because the
 *        question is not "does the project declare this name" (it does) but "which of the
 *        declarations is the receiver's type".
 *
 *   **W3 — THE PROJECT DECLARES IT NOWHERE.** It is a member of a type the project does not
 *        declare — an SDK or third-party package type. The project's key space CANNOT answer this
 *        by construction, and neither can an evidence class at the site: the type is not in the
 *        project at all. **The instrument for this class is a CLAIM (the `namespace` claim for
 *        SDK names, the package-scope claim for package names), and NO static evidence class at
 *        the site can settle it** — because there is no declaration to point at.
 *
 * ## WHAT IT READS
 *
 * The GATE'S OWN `--dump` rows (population, rule and outcome are the gate's by construction), each
 * dumped file's OWN analyzer output (re-parsed through the same `parseFile` call the gate makes),
 * and each repo's OWN declaration key space (the same index builder, over the gate's admitted file
 * list with the gate's own 1 MB cap). It emits NOTHING into the analyzer.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { buildProjectIndexStreaming, DART_DECLARATION_SPEC } from "../../src/ast/project-index"
import { BINDING_SEP } from "../../src/ast/types"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const argOf = (name: string): string | undefined => {
  const withEq = argv.find((a) => a.startsWith(`${name}=`))
  if (withEq) return withEq.slice(name.length + 1)
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const DUMP = argOf("--dump") ?? ""
const REPO_ARG = argOf("--repo") ?? ""
if (!DUMP) { console.error("usage: bun run script/m14/dart-uses-wall-classes.ts --dump=<dump> [--repo=<name>]"); process.exit(2) }
const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const WASM = path.join(ROOT, "wasm", "tree-sitter-dart.wasm")
const SIZE_CAP = 1048576

type Row = { label: string; outcome: string; target: string; srcFile: string; line: number }
const rows: Row[] = []
for (const line of readFileSync(DUMP, "utf8").split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t")
  if (p.length < 6) continue
  const loc = p[4]
  const colon = loc.lastIndexOf(":")
  rows.push({ label: p[1], outcome: p[2], target: p[3], srcFile: colon > 1 ? loc.slice(0, colon) : loc, line: colon > 1 ? Number(loc.slice(colon + 1)) || 0 : 0 })
}
const repoOf = (f: string): string => {
  const rel = f.startsWith(CR) ? f.slice(CR.length + 1) : f
  return rel.split(path.sep)[0]
}
const repos = REPO_ARG ? new Set(REPO_ARG.split(",").map((s) => s.trim()).filter(Boolean)) : new Set(rows.map((r) => repoOf(r.srcFile)))

// THE PROJECT'S KEY SPACE, per repo, over the gate's admitted file set.
const projectNames = new Map<string, Set<string>>()
const projectMembers = new Map<string, Set<string>>()
for (const repo of repos) {
  const repoRoot = path.join(CR, repo)
  const tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "*.dart"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
    .split("\n").filter(Boolean).map((f) => path.join(repoRoot, f))
    .filter((f) => { try { return statSync(f).size <= SIZE_CAP } catch { return false } })
  const index = await buildProjectIndexStreaming(WASM, tracked, DART_DECLARATION_SPEC)
  projectNames.set(repo, new Set(index.symbolNames))
  const members = new Set<string>()
  for (const [, ms] of index.typeMembers) for (const m of ms) members.add(m)
  projectMembers.set(repo, members)
}

// THE ANALYZER'S OWN OUTPUT PER FILE — the only evidence that can say "this name is bound HERE".
const fileBindings = new Map<string, Set<string>>()
const fileCache = new Map<string, any>()
async function bindingsFor(file: string): Promise<Set<string>> {
  const hit = fileBindings.get(file)
  if (hit) return hit
  const repoRoot = path.join(CR, repoOf(file))
  let r: any
  try { r = await parseFile(file, repoRoot, { projectRoot: repoRoot } as any) } catch { r = null }
  const set = new Set<string>()
  for (const rel of Array.isArray(r?.relationships) ? r.relationships : []) {
    const t = String(rel?.target ?? "")
    const i = t.indexOf(BINDING_SEP)
    if (i > 0) set.add(t.slice(i + BINDING_SEP.length))
  }
  fileCache.set(file, r)
  fileBindings.set(file, set)
  return set
}

const classes = { W1_file_binds_it: 0, W2_project_member: 0, W3_project_declares_nothing: 0 }
const byName = new Map<string, { cls: string; rows: number }>()
for (const r of rows) {
  if (r.label !== "uses" || r.outcome !== "unresolved") continue
  const repo = repoOf(r.srcFile)
  const boundHere = (await bindingsFor(r.srcFile)).has(r.target)
  let cls: string
  if (boundHere) cls = "W1_file_binds_it"
  else if ((projectMembers.get(repo)?.has(r.target) ?? false) || (projectNames.get(repo)?.has(r.target) ?? false)) cls = "W2_project_member"
  else cls = "W3_project_declares_nothing"
  classes[cls]++
  const cur = byName.get(r.target)
  if (cur) cur.rows++
  else byName.set(r.target, { cls, rows: 1 })
}

const total = classes.W1_file_binds_it + classes.W2_project_member + classes.W3_project_declares_nothing
console.log(`dart-uses-wall-classes — ${[...repos].join(",")} · ${total} unresolved \`uses\` row(s)`)
console.log(`  (classified by the ANALYZER'S OWN output per file — a name's SPELLING is not evidence of what it is)`)
console.log("")
for (const [k, v] of Object.entries(classes)) {
  console.log(`  ${k.padEnd(28)} ${String(v).padStart(7)}  ${((v / total) * 100).toFixed(1)}%`)
}
console.log("")
for (const cls of ["W1_file_binds_it", "W2_project_member", "W3_project_declares_nothing"]) {
  const top = [...byName.entries()].filter(([, v]) => v.cls === cls).sort((a, b) => b[1].rows - a[1].rows).slice(0, 15)
  if (top.length === 0) continue
  console.log(`   ${cls}: ${top.map(([n, v]) => `${n} ${v.rows}`).join(" · ")}`)
}
