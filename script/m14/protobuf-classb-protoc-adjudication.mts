/**
 * PROTOBUF LANE — class B within one repository, adjudicated by `protoc` itself.
 *
 * ## Why this file exists
 *
 * `protobuf-classb-within-repo.mts` printed all 50 ids pass 20 carried as a bare count
 * ("50 within one repository"), and established that each is published by two or more files
 * carrying DISTINCT declaration bytes. That left the only question the brief actually asks —
 * *is this a scoping failure the analyzer owns, or a fact about the corpus?* — answered by
 * argument. This file answers it with the compiler.
 *
 * The discriminator is `protoc`'s own duplicate-symbol diagnostic. Protobuf's identity is the
 * fully-qualified name, so:
 *
 *  - if one `protoc` invocation holding every declaring file REJECTS the set with
 *    `"<id>" is already defined in file "<other>"`, then no compilation unit can hold both
 *    declarations, each file is correct in its own compilation unit, and the id that collides
 *    is correct in both. The collision is a fact about the corpus and no analyzer-side scoping
 *    rule can remove it.
 *  - if one `protoc` invocation ACCEPTING every declaring file, the compiler says there is ONE
 *    symbol there and this analyzer published TWO ids for it. That is a scoping failure in the
 *    analyzer, it is the brief's class B, and it is repairable inside this lane.
 *  - any other `protoc` outcome — an unresolved import, a syntax error, a timeout — means the
 *    compiler never reached the duplicate check. That row is INCONCLUSIVE and is reported as
 *    such. It is not counted either way.
 *
 * The middle case is the whole point: pass 20 argued from the fact that `protoc` "would reject
 * the duplicate symbol outright", and never ran `protoc`. This file runs it, on 50 rows, and
 * reports how many came back each way.
 *
 * ## Getting `protoc` to reach the check
 *
 * A duplicate is only reported once every `import` in the file has resolved, so the include
 * roots decide whether a row is adjudicable at all. Every directory that is an ANCESTOR of a
 * `.proto` file inside the row's repository is passed as `-I`, plus `grpc_tools`' bundled
 * well-known types, plus the CORPUS root and the repository root. That is the widest set of
 * roots available without being told the project's real build, and it is stated rather than
 * assumed sufficient: a row whose only failure is an unresolved import is inconclusive, not
 * clean.
 *
 * ## Why this does not substitute for the pass-8 oracle
 *
 * Pass 8 adjudicated `uses` targets with `protoc` at protobuf v3.x. This runs
 * `grpc_tools.protoc` (libprotoc 35.1) on whole FILES rather than on single name lookups, and it
 * asks a different question. Both facts are recorded in the output so neither number is read as
 * the other's.
 *
 * ## No regex
 *
 * Directories come from `path` operations, ids from production `parseFile` output, and the
 * duplicate verdict from `protoc`'s exit code plus a byte comparison of its diagnostic against
 * the id already in hand. No source text is pattern-matched. The one `includes()` test is over
 * protoc's own stderr and the id string, not over corpus source.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { spawnSync } from "node:child_process"
import { parseFile } from "../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.env.BB_OUT ?? "/tmp/opencode/pb/classB-protoc.json"
const PROTOC = process.env.BB_PROTOC ?? "/tmp/opencode/protoc-venv/bin/python"
const PROTOC_ARGS = ["-m", "grpc_tools.protoc"]
const PER_CALL_MS = Number(process.env.BB_PROTOC_TIMEOUT_MS ?? 60000)

type Decl = { file: string; repo: string; text: string }

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) walk(full, out)
    else if (e.isFile() && e.name.endsWith(".proto")) out.push(full)
  }
}

const repoOf = (f: string): string => {
  const rel = path.relative(CORPUS, f)
  return rel.split(path.sep)[0] || "(corpus root)"
}

/** Every directory on the path from `root` down to `file`'s own directory. */
function ancestorDirs(root: string, file: string): string[] {
  const dir = path.dirname(file)
  const rel = path.relative(root, dir)
  if (rel === "") return [root]
  if (rel.startsWith("..")) return []
  const out: string[] = []
  let acc = root
  out.push(acc)
  for (const seg of rel.split(path.sep)) {
    acc = path.join(acc, seg)
    out.push(acc)
  }
  return out
}

type Verdict = "both-compile" | "duplicate-symbol" | "inconclusive"

interface ProtocOutcome {
  verdict: Verdict
  exit: number | null
  signal: string | null
  /** The diagnostic lines, verbatim, for the rows worth reading by hand. */
  stderr: string
  /** How many of the row's `import` strings protoc resolved. Bounded and declared. */
  includeRoots: number
}

function runProtoc(id: string, files: string[], roots: string[]): ProtocOutcome {
  const args = [...PROTOC_ARGS]
  for (const r of roots) args.push(`-I${r}`)
  // /dev/null discards the descriptor set; the question asked is whether the SET compiles, not
  // what it contains, so the output is not needed and writing it would only cost time.
  args.push("--descriptor_set_out=/dev/null", ...files)

  const r = spawnSync(PROTOC, args, {
    encoding: "utf8",
    timeout: PER_CALL_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
  const stderr = r.stderr ?? ""
  const signal = r.signal ?? null
  const code = typeof r.status === "number" ? r.status : null

  // protoc's duplicate diagnostic quotes the id and the other file's BASENAME. Matching on the
  // id this row is about, rather than on the phrase "already defined", is what keeps a
  // DIFFERENT file's duplicate from being scored as this row's verdict.
  const isDuplicate = stderr.includes(`"${id}" is already defined in file`)

  let verdict: Verdict
  if (isDuplicate) verdict = "duplicate-symbol"
  else if (code === 0) verdict = "both-compile"
  else verdict = "inconclusive"

  return { verdict, exit: code, signal, stderr, includeRoots: roots.length }
}

async function main(): Promise<void> {
  const files: string[] = []
  walk(CORPUS, files)
  files.sort()

  const byId = new Map<string, Decl[]>()
  let parsed = 0
  let failed = 0

  for (const f of files) {
    let src: string
    let prod: any
    try {
      src = fs.readFileSync(f, "utf8")
      prod = await parseFile(f, "protobuf")
    } catch {
      failed++
      continue
    }
    parsed++
    for (const s of (prod.symbols ?? []) as any[]) {
      const id = String(s.qualifiedName ?? "")
      if (id === "") continue
      const start = typeof s.startIndex === "number" ? s.startIndex : 0
      const end = typeof s.endIndex === "number" ? s.endIndex : 0
      const arr = byId.get(id) ?? []
      arr.push({ file: f, repo: repoOf(f), text: src.slice(start, end) })
      byId.set(id, arr)
    }
  }

  // Pass 20's population, reproduced here so the two probes cannot drift: more than one file,
  // all inside ONE repository, holding at least two distinct declaration texts.
  const rows: { id: string; decls: Decl[] }[] = []
  for (const [id, decls] of byId) {
    const repos = new Set(decls.map((d) => d.repo))
    if (repos.size !== 1) continue
    const uniq: Decl[] = []
    for (const d of decls) if (!uniq.some((u) => u.file === d.file && u.text === d.text)) uniq.push(d)
    if (uniq.length < 2) continue
    let anyDistinct = false
    for (let i = 0; i < uniq.length && !anyDistinct; i++)
      for (let j = i + 1; j < uniq.length; j++)
        if (uniq[i]!.text.trim() !== uniq[j]!.text.trim()) {
          anyDistinct = true
          break
        }
    if (anyDistinct) rows.push({ id, decls: uniq })
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  // Include roots, computed ONCE per repository and reused: the roots depend on the repository,
  // not on the row, and rebuilding them per row is what would make this probe slow.
  const rootsByRepo = new Map<string, string[]>()
  for (const f of files) {
    const repo = repoOf(f)
    let set = rootsByRepo.get(repo)
    if (!set) {
      set = []
      rootsByRepo.set(repo, set)
    }
    for (const d of ancestorDirs(path.join(CORPUS, repo), f)) if (!set.includes(d)) set.push(d)
  }
  // Well-known types ship inside grpc_tools; without them every `import "google/protobuf/*.proto"`
  // is unresolvable and the row is scored inconclusive for a reason that has nothing to do with
  // the duplicate.
  const wkt = path.join(path.dirname(PROTOC), "..", "lib", "python3.12", "site-packages", "grpc_tools", "_proto")
  if (fs.existsSync(wkt)) for (const d of ancestorDirs(wkt, path.join(wkt, "google", "protobuf", "any.proto"))) {
    for (const set of rootsByRepo.values()) if (!set.includes(d)) set.push(d)
  }
  for (const set of rootsByRepo.values()) set.push(CORPUS)

  const results: any[] = []
  const tally: Record<Verdict, number> = { "both-compile": 0, "duplicate-symbol": 0, inconclusive: 0 }
  const byRepo: Record<string, Record<Verdict, number>> = {}

  for (const row of rows) {
    const roots = rootsByRepo.get(row.decls[0]!.repo) ?? []
    const out = runProtoc(row.id, row.decls.map((d) => d.file).sort(), roots)
    tally[out.verdict]++
    const rk = row.decls[0]!.repo
    byRepo[rk] ??= { "both-compile": 0, "duplicate-symbol": 0, inconclusive: 0 }
    byRepo[rk]![out.verdict]++
    results.push({
      id: row.id,
      repo: rk,
      files: row.decls.map((d) => path.relative(path.join(CORPUS, rk), d.file)).sort(),
      verdict: out.verdict,
      exit: out.exit,
      signal: out.signal,
      includeRoots: out.includeRoots,
      stderr: out.verdict === "both-compile" ? "" : out.stderr.split("\n").slice(0, 6).join(" | "),
    })
    console.log(`${out.verdict.padEnd(17)} ${row.id}   [${rk}]  ${row.decls.length} files`)
  }

  console.log(`\ncorpus: ${files.length} .proto files on disk`)
  console.log(`parsed ${parsed}  failed ${failed}`)
  console.log(`distinct published ids ${byId.size}`)
  console.log(`class B within one repository, two distinct declaration texts ${rows.length}`)
  console.log(`\nPROTOC VERDICT OVER THOSE ${rows.length} ROWS`)
  console.log(`  protoc REJECTS the set (duplicate symbol) ${tally["duplicate-symbol"]}`)
  console.log(`  protoc ACCEPTS the set (one symbol, two ids) ${tally["both-compile"]}`)
  console.log(`  inconclusive (protoc never reached the check) ${tally.inconclusive}`)
  console.log(`\nper repository`)
  for (const [repo, t] of Object.entries(byRepo).sort())
    console.log(
      `  ${repo.padEnd(24)} duplicate ${String(t["duplicate-symbol"]).padStart(3)}  both-compile ${String(t["both-compile"]).padStart(3)}  inconclusive ${String(t.inconclusive).padStart(3)}`,
    )

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        corpus: files.length,
        parsed,
        failed,
        distinctIds: byId.size,
        rows: results.length,
        tally,
        byRepo,
        results,
      },
      null,
      2,
    ),
  )
  console.log(`\nwrote ${OUT}`)
}

await main()
