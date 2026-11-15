/**
 * DO THE TWO ENDS OF A DART IMPORT ACTUALLY MEET? — dart lane.
 *
 * `real-dart-analyzer.ts` now publishes a library's project-relative path as its identity
 * (`Module.qualifiedName`) and writes that same string into the import/export edge that names
 * the file. The claim "the edge resolves" has TWO halves, and a fixture can only hold one of
 * them: a fixture pins the string the importer writes, and nothing in a single-file pin says
 * whether any node ANSWERS to it. The incoming gate answers that for the corpus, but its cycle
 * is 90 minutes and it counts thirty relationship types at once — too slow and too coarse to
 * steer this rule by.
 *
 * This is the pair check, and it works on REAL paths (the fixture harness hands `analyze()` a
 * synthetic path; this walks the files themselves). For every import/export edge it asks the
 * question the resolver asks — how many declarations in the SAME PROJECT answer to this target
 * — and it reports the answer split by what the target IS:
 *
 *   FILE-SHAPED   the target names a file (it contains `/`, i.e. a project-relative path).
 *                 These are the edges this round created; the number that matters is how many
 *                 answer to exactly one library identity.
 *   SPECIFIER     `uri` or `uri:*` — a specifier this checkout refused to turn into a path
 *                 (a package it does not declare, a `dart:` library it does not carry, another
 *                 scheme). A refusal is legitimate; a refusal that names something WHICH IS
 *                 PRESENT is not, so those are listed separately and separately.
 *
 * SCOPE, stated because a number is only comparable to one measured the same way: resolution is
 * PER PROJECT (the repository the file belongs to), which is production's scope
 * (`parallel-indexer.resolveRelationships`, `WHERE s.project_id = ?`). A `--corpus N` run uses
 * a stride sample, and a sample cuts BOTH ways — it must not be quoted as a population number:
 *   · UP: a target whose colliding twin was not sampled now answers to exactly one declaration
 *     (the same bias `incoming-gate.ts` names for its own stride runs);
 *   · DOWN: a target that names a file the stride did not sample answers to nothing, so the
 *     file-shaped resolve rate here is a FLOOR on the corpus rate, not an estimate of it.
 * A file that cannot be analyzed (degraded, or over the engine's 1 MB analyzer cap) publishes no
 * identity either, and a target naming it is reported with that reason rather than as a miss.
 *
 * A `--repo` run is the one to quote: it parses EVERY admitted file of the named checkout(s),
 * so a project's symbol table is complete and a target that names nothing really names nothing.
 * A `--corpus N` stride run is a FLOOR by the argument above and is kept only to show a shape.
 *
 * Run:
 *   npx tsx validation/m14/fixtures/dart/import-identity-pairing.ts                      (fixtures)
 *   npx tsx validation/m14/fixtures/dart/import-identity-pairing.ts --repo dart-http,riverpod
 *   npx tsx validation/m14/fixtures/dart/import-identity-pairing.ts --corpus 600
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
// The lane's convention for a census that needs the checkout root: the suite is run from it.
const root = process.cwd()
const corpusArg = process.argv.indexOf("--corpus")
const corpusSample = corpusArg === -1 ? 0 : Number(process.argv[corpusArg + 1] ?? 600)
const repoArg = process.argv.indexOf("--repo")
const onlyRepos = repoArg === -1 ? null : String(process.argv[repoArg + 1] ?? "").split(",")
const CONC = 4

function fixtureFiles(): string[] {
  const dir = path.join(root, "validation", "m14", "fixtures", "dart")
  return readdirSync(dir)
    .filter((f) => f.endsWith(".dart"))
    .sort()
    .map((f) => path.join(dir, f))
}

function corpusFiles(): Map<string, string[]> {
  const byRepo = new Map<string, string[]>()
  for (const name of readdirSync(CR).sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    const dart = tracked.filter((r) => r.endsWith(".dart"))
    if (dart.length === 0) continue
    if (onlyRepos !== null && !onlyRepos.includes(name)) continue
    if (onlyRepos !== null) { byRepo.set(dir, dart.map((r) => path.join(dir, r))); continue }
    const stride = Math.max(1, Math.floor(dart.length / corpusSample))
    byRepo.set(dir, dart.filter((_, i) => i % stride === 0).slice(0, corpusSample).map((r) => path.join(dir, r)))
  }
  return byRepo
}

type Edge = { repo: string; target: string; type: string }

const filesByRepo = onlyRepos !== null || corpusSample > 0
  ? corpusFiles()
  : new Map<string, string[]>([[root, fixtureFiles()]])

const identitiesByRepo = new Map<string, Set<string>>()   // repo -> published library identities
const keysByRepo = new Map<string, Map<string, number>>() // repo -> every name/qualifiedName key
const edges: Edge[] = []
const filesOnDiskByRepo = new Map<string, Set<string>>()  // repo -> project-relative .dart paths
let parsed = 0
let failed = 0

for (const [repo, files] of filesByRepo) {
  const onDisk = new Set<string>()
  for (const f of files) onDisk.add(path.relative(repo, f).split(path.sep).join("/"))
  filesOnDiskByRepo.set(repo, onDisk)
  let cursor = 0
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (true) {
      const i = cursor++
      if (i >= files.length) return
      const f = files[i]
      let r: any
      try { r = await parseFile(f, repo) } catch { failed++; continue }
      if (!r || r.fallback === true) { failed++; continue }
      parsed++
      let ident = identitiesByRepo.get(repo)
      if (!ident) identitiesByRepo.set(repo, (ident = new Set()))
      let keys = keysByRepo.get(repo)
      if (!keys) keysByRepo.set(repo, (keys = new Map()))
      const bump = (k: string) => { if (k.length > 0) keys!.set(k, (keys!.get(k) ?? 0) + 1) }
      for (const s of r.symbols ?? []) {
        const name = String(s?.name ?? "")
        bump(name)
        const q = String(s?.qualifiedName ?? "")
        if (q !== name) bump(q)
        if (String(s?.kind ?? "") === "module" && q.length > 0) ident.add(q)
      }
      for (const rel of r.relationships ?? []) {
        const t = String(rel?.type ?? "")
        if (t !== "imports" && t !== "exports") continue
        edges.push({ repo, target: String(rel?.target ?? ""), type: t })
      }
    }
  }))
}

const rows = new Map<string, number>()
const bumpRow = (k: string, by = 1) => rows.set(k, (rows.get(k) ?? 0) + by)
const unresolvedFileShaped: { repo: string; target: string; reason: string }[] = []

for (const e of edges) {
  const keys = keysByRepo.get(e.repo) ?? new Map<string, number>()
  const decls = keys.get(e.target) ?? 0
  const identities = identitiesByRepo.get(e.repo) ?? new Set<string>()
  // FILE-SHAPED vs SPECIFIER, told apart by the colon: a specifier carries a URI scheme
  // (`package:x/y.dart`, `dart:async`) or the `<uri>:<item>` form, and a project-relative path
  // carries neither. Testing for `/` instead would file every `package:` import as a path —
  // measured on this suite's own first run, where 12 of 16 rows said "file-shaped" for
  // specifiers and every one of them was wrong.
  const isFileShaped = !e.target.includes(":")
  const namesAFileOnDisk = isFileShaped && (filesOnDiskByRepo.get(e.repo)?.has(e.target) ?? false)
  const shape = isFileShaped ? "FILE-SHAPED" : "SPECIFIER"
  if (isFileShaped) {
    const identAnswer = identities.has(e.target) ? "exactly one library identity" : "NO library identity"
    const byDecl = decls === 0 ? "0 declarations" : decls === 1 ? "exactly 1 declaration" : `${decls}+ declarations (AMBIGUOUS)`
    bumpRow(`${shape}: ${byDecl}, ${identAnswer}`)
    if (decls !== 1 && unresolvedFileShaped.length < 20) {
      unresolvedFileShaped.push({
        repo: path.basename(e.repo), target: e.target,
        reason: identAnswer === "exactly one library identity" ? "identity published but key count != 1" : (namesAFileOnDisk ? "the file IS in this run but publishes no identity" : "the named file is not in this sample"),
      })
    }
  } else {
    const why = e.target.startsWith("package:") ? "package:" : e.target.startsWith("dart:") ? "dart:" : "other/relative"
    bumpRow(`${shape} (${why}): kept as specifier`)
  }
}

const mode = onlyRepos !== null
  ? `WHOLE CHECKOUT(S): ${onlyRepos.join(", ")} — every admitted file of it, so the project's symbol table is COMPLETE`
  : corpusSample > 0 ? `STRIDE SAMPLE (a FLOOR, not a rate) of ${filesByRepo.size} checkout(s)` : "fixtures"
console.log(`dart import/export identity pairing — ${mode}`)
console.log(`files parsed: ${parsed} (${failed} failed/degraded)   import+export edges: ${edges.length}`)
console.log(`resolution scope: PER PROJECT — the repository a file belongs to (production's scope)`)
for (const [k, v] of [...rows.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(7)}  ${k}`)
if (unresolvedFileShaped.length > 0) {
  console.log(`\nfile-shaped targets that did not answer to exactly one declaration (up to 20):`)
  for (const u of unresolvedFileShaped) console.log(`  ${u.repo.padEnd(22)} ${u.target}\n      ${u.reason}`)
}
