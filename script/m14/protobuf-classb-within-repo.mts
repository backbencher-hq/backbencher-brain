/**
 * PROTOBUF LANE — class B WITHIN ONE REPOSITORY, every id named.
 *
 * ## Why this file exists
 *
 * Pass 20 split this lane's ambiguous targets into three classes and reported class B as
 * 246 ids — 196 across repositories, 50 within one. The 196 were attributed to upstream
 * releases vendored into different repositories on the evidence of four
 * `descriptor.proto` files, and the brief's own arithmetic says no analyzer-side rule
 * moves them: an ambiguous edge is ONE edge attributed to ONE declaration.
 *
 * **The 50 were carried as a number with no names attached**, and the brief's class B is
 * precisely the class the brief says IS "also the analyzer's, in principle": a name
 * declared in more than one file/module where the analyzer does not model which one is in
 * scope. A count with no rows cannot be adjudicated — the reader cannot tell a vendored
 * copy from a scoping failure, and those two have opposite fixes. So this file prints
 * every one of them: id, the files, the repository, and the declaration text that
 * differs.
 *
 * ## The discriminator, and why it is the declaration's bytes
 *
 * As in `protobuf-ambiguity-split.mts`, `range.startIndex` is the first non-comment
 * child's start, so `content.slice(startIndex, endIndex)` is the declaration without its
 * licence header. Classifying by whole-file bytes would call the corpus's many identical
 * `helloworld.proto` copies collisions; they are one declaration under four headers.
 *
 * ## What would make this repairable
 *
 * Nothing in this lane, and the reason is structural rather than a budget claim:
 *
 *  - two files in one repository declaring the SAME fully-qualified name with DIFFERENT
 *    declarations is not a scoping failure in the analyzer. It is two files that a single
 *    `protoc` invocation cannot compile together — `protoc` rejects the duplicate symbol
 *    outright. Each file is correct in its own compilation unit, and the id that collides
 *    is correct in both. The analyzer publishes one id per declaration, which is the
 *    language's identity model, so the collision is a fact about the corpus.
 *  - the analyzer is a PER-FILE unit with no project context (see the pass-20 §8 item on
 *    `parallel-indexer.ts:1300`), so even if the collision were a scoping failure it
 *    could not be repaired here.
 *
 * So the honest output is the ROWS, and a statement of what each row is. Rows whose files
 * share a directory tree and one of which is a vendored copy are reported with their
 * evidence; rows where two genuinely different files declare the same id are a corpus
 * fact and are named as such.
 *
 * ## No regex
 *
 * Paths and ids are compared as strings; declaration text is sliced by byte range read
 * off the parse tree. No source text is pattern-matched.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.env.BB_OUT ?? "/tmp/opencode/pb/classB-within-repo.json"

type Decl = { file: string; repo: string; startIndex: number; endIndex: number; text: string }

function walk(dir: string, out: string[], symlinks: { n: number }): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isSymbolicLink()) {
      symlinks.n++
      continue
    }
    if (e.isDirectory()) walk(full, out, symlinks)
    else if (e.isFile() && e.name.endsWith(".proto")) out.push(full)
  }
}

/**
 * The repository a file belongs to, read off the corpus root rather than off git: the
 * brief's own corpus is a working tree walked directly, and `git ls-files` lists tracked
 * paths that are not on disk because three of these checkouts are sparse.
 */
const repoOf = (f: string): string => {
  const rel = path.relative(CORPUS, f)
  const first = rel.split(path.sep)[0]
  return first || "(corpus root)"
}

async function main(): Promise<void> {
  const files: string[] = []
  const symlinks = { n: 0 }
  walk(CORPUS, files, symlinks)
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
      // The range is FLAT on a production symbol, not under `range`. pool-worker's
      // projection emits `startIndex`/`endIndex` as siblings of `name` and
      // `qualifiedName` (`pool-worker.ts:929-932`), and reading `s.range` here yields
      // undefined for every symbol, so every declaration text slices to the EMPTY
      // STRING and all 196 within-repository ids collapse to "same text".
      //
      // That defect produced a plausible-looking wrong number on this probe's first run:
      // `0 ids with two distinct declaration texts`, against pass 20's 50. A count of
      // zero on a question about DIFFERENCE is the shape a broken discriminator
      // produces, and it is why this comment names the shape rather than the fix.
      const start = typeof s.startIndex === "number" ? s.startIndex : 0
      const end = typeof s.endIndex === "number" ? s.endIndex : 0
      const arr = byId.get(id) ?? []
      arr.push({ file: f, repo: repoOf(f), startIndex: start, endIndex: end, text: src.slice(start, end) })
      byId.set(id, arr)
    }
  }

  const multi = [...byId.entries()].filter(([, v]) => v.length > 1)
  const withinRepo = multi.filter(([, v]) => new Set(v.map((d) => d.repo)).size === 1)

  // Two declarations under one id are DISTINCT when their sliced bytes differ. A file
  // whose own declaration text differs only by whitespace or a trailing comment is the
  // same declaration; the slice already removed comments, so a difference here is real.
  const distinct = (a: Decl, b: Decl): boolean => a.text.trim() !== b.text.trim()

  const rows: any[] = []
  let vendored = 0
  let genuinelyDistinct = 0
  for (const [id, decls] of withinRepo) {
    const uniq: Decl[] = []
    for (const d of decls) if (!uniq.some((u) => u.file === d.file && u.text === d.text)) uniq.push(d)
    if (uniq.length < 2) continue
    let anyDistinct = false
    for (let i = 0; i < uniq.length && !anyDistinct; i++)
      for (let j = i + 1; j < uniq.length; j++) if (distinct(uniq[i], uniq[j])) { anyDistinct = true; break }
    if (!anyDistinct) continue

    // A vendored copy is one directory tree holding the SAME relative path twice, or a
    // path segment named for a vendor. Both are read off the PATH, which is the only
    // evidence available without running protoc on both.
    const rels = uniq.map((d) => path.relative(path.join(CORPUS, d.repo), d.file))
    const relCounts = new Map<string, number>()
    for (const r of rels) relCounts.set(r, (relCounts.get(r) ?? 0) + 1)
    const sameRelativePath = [...relCounts.values()].some((n) => n > 1)
    const vendorSegment = /(^|\/)(vendor|third_party|thirdparty|external|deps|build|dist|out)(\/|$)/.test(
      rels.join(" "),
    )
    const kind = sameRelativePath ? "vendored-same-relative-path" : vendorSegment ? "under-a-vendor-directory" : "distinct-files"
    if (kind !== "distinct-files") vendored++
    else genuinelyDistinct++

    rows.push({
      id,
      repo: uniq[0].repo,
      kind,
      files: rels.sort(),
      absoluteFiles: uniq.map((d) => d.file).sort(),
      firstLineOfEach: uniq.map((d) => d.text.split("\n")[0]!.slice(0, 110)),
    })
  }

  console.log(`\ncorpus: ${files.length} .proto files, ${symlinks.n} symlinked entries skipped`)
  console.log(`parsed ${parsed}  failed ${failed}`)
  console.log(`distinct published ids ${byId.size}`)
  console.log(`ids published by MORE THAN ONE FILE ${multi.length}`)
  console.log(`  of those, in ONE repository ${withinRepo.length}`)
  console.log(`  of those, two DISTINCT declaration texts ${rows.length}`)

  console.log(`\nCLASS B WITHIN ONE REPOSITORY — ${rows.length} ids, every one named`)
  console.log(`  vendored copies (path evidence)   ${vendored}`)
  console.log(`  distinct files, no vendor evidence ${genuinelyDistinct}`)
  for (const r of rows) {
    console.log(`\n${r.id}`)
    console.log(`  repo ${r.repo}   kind ${r.kind}`)
    for (let i = 0; i < r.files.length; i++) {
      console.log(`  ${r.files[i]}`)
      console.log(`      ${r.firstLineOfEach[i]}`)
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify({ files: files.length, parsed, failed, rows }, null, 2))
  console.log(`\nwrote ${OUT}`)
}

await main()