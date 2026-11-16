/**
 * STORE BINDING — does the reverse walk have anything to walk?
 *
 * ## Why this file exists
 *
 * Every other instrument in this lane answers the OUTGOING question: one file in,
 * edges out, and both endpoints compared against the analyzer's own id set. That
 * set is not what the product indexes. `pool-worker` projects each symbol down to a
 * fixed shape and `metadata.id` does not survive it, so the question "does a
 * `contains` edge bind to a row a reverse walk can find?" was never asked.
 *
 * It is asked here, end to end, through the real indexer and the real store:
 * `indexProjectParallel` writes `brain_symbol` and `brain_relationship`, then
 * `resolveRelationships` runs its four strategies against them. Nothing is
 * simulated. The output is one row per relationship type carrying the count the
 * store can walk BACK from.
 *
 * ## Why the answer is not automatic
 *
 * `src/ast/parallel-indexer.ts:resolveRelationships` binds a target by, in order:
 *
 *   1. `target_external = brain_symbol.qualified_name`      (exact)
 *   2. `target_external = brain_symbol.name`                (only where the name is unique)
 *   3. `target_external.name = SUBSTR(target_external, INSTR(target_external,'.')+1)`
 *      — i.e. everything AFTER THE FIRST dot
 *   4. the `<module>:<item>` import form
 *
 * Protobuf's identifiers are DOTTED and PACKAGE-QUALIFIED, so all three of the
 * name strategies have to line up with the spelling the analyzer chose:
 *
 *   - a target `google.protobuf.Mixin.root` only binds by strategy 1, and only if
 *     the field symbol publishes `qualified_name = "google.protobuf.Mixin.root"`.
 *     Strategy 2 compares the whole dotted target to a bare `name`, which never
 *     matches. Strategy 3 takes the text after the FIRST dot, which for a protobuf
 *     target is `protobuf.Mixin.root` — not a name the language can declare.
 *
 * So the spelling of the endpoint is not cosmetic: it decides whether the graph
 * can reach a declaration at all. This probe measures which spelling is shipped.
 *
 * ## The shared blocker, and why this file derives a copy
 *
 * At HEAD, `storeResults` cannot store anything, for ANY language. Its
 * `insertSymbol` prepared statement carries TWO `VALUES` clauses — 31
 * placeholders then 30 — left by merge 687999ba ("reconcile the local line with
 * the consolidated origin/main"), and SQLite rejects the statement outright:
 *
 *   SqliteError: near "VALUES": syntax error
 *     at storeResults (src/ast/parallel-indexer.ts:2153)
 *
 * Measured by calling `storeResults` directly with a two-file batch: typescript,
 * python and java all throw the same error, so it is not this lane's and not this
 * language's. It means the store-level question below is currently unanswerable
 * for every language at once.
 *
 * `src/ast/parallel-indexer.ts` is shared machinery this lane does not own, so it
 * is NOT edited here. Instead this probe DERIVES a copy with that one duplicated
 * line removed, indexes through the derived copy, and deletes the copy — the same
 * technique `script/m14/protobuf-ruling-table-proof.mts` uses for the arbiter, and
 * it is what keeps the number below a real indexer and a real store rather than a
 * re-implementation of them. The splice REFUSES to run if its anchor is not found
 * exactly once, so a silently-unrepaired copy reports as a loud failure instead of
 * as a measurement.
 *
 * `--no-derive` runs against the shared file as shipped, which fails. That is the
 * default behaviour worth having on the record, so it is one flag away.
 *
 * ## Usage
 *
 *   npx tsx script/m14/tmp/protobuf/probe/store-binding.mts [--files N] [--no-derive]
 *
 * Reads real corpus files, writes a scratch database under the OS temp dir, and
 * deletes it. Prints the per-type table and exits 0 whatever it finds — the
 * number is the output, the exit code is not the verdict.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { getProjectId } from "../../../../../src/cli/index"
import { BrainDatabase } from "../../../../../src/brain/database"

const CORPUS = process.env.BB_CORPUS_ROOT || "<corpus-root>/bb_tests/repositories"
// `pb-reference/src/google/protobuf` is the densest cross-file reference set in the
// corpus: the well-known types are declared in one file and named from the others,
// which is the only shape in which "the reverse walk found it" is a question at all.
const SRC = path.join(CORPUS, "pb-reference/src/google/protobuf")

function argInt(flag: string, dflt: number): number {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? Number(process.argv[i + 1]) : dflt
}
const N = argInt("--files", 40)
const DERIVE = !process.argv.includes("--no-derive")

/**
 * The duplicated VALUES clause, exactly as it stands at HEAD. 31 placeholders then
 * 30, on consecutive lines, inside the `insertSymbol` prepared statement. Matched
 * as ONE string so a partial match cannot splice a half-repaired statement.
 */
const DUPLICATED_VALUES =
  "     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n" +
  "     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC_AST = path.join(HERE, "..", "..", "..", "..", "..", "src", "ast")
const DERIVED_INDEXER = path.join(SRC_AST, ".derived-parallel-indexer-for-protobuf.ts")

/**
 * Produce a runnable `indexProjectParallel`. Returns the shared module untouched
 * when `--no-derive`, and a path to DELETE when a derived copy was written.
 * Throws rather than proceeding if the anchor moved: a probe that measures the
 * wrong thing quietly is worse than a probe that refuses.
 */
async function loadIndexer(): Promise<{ run: (projectId: any, root: string, opts: any) => Promise<any>; cleanup: () => void }> {
  if (!DERIVE) {
    console.log("(--no-derive: running against src/ast/parallel-indexer.ts AS SHIPPED)")
    const shared: any = await import(pathToFileURL(path.join(SRC_AST, "parallel-indexer.ts")).href)
    return { run: shared.indexProjectParallel, cleanup: () => {} }
  }
  const src = fs.readFileSync(path.join(SRC_AST, "parallel-indexer.ts"), "utf8")
  const occurrences = src.split(DUPLICATED_VALUES).length - 1
  if (occurrences !== 1) {
    throw new Error(
      `store-binding REFUSES to measure: expected the duplicated VALUES clause exactly once in ` +
        `src/ast/parallel-indexer.ts, found ${occurrences}. The shared blocker at ` +
        `src/ast/parallel-indexer.ts:2163-2165 has either been fixed or moved. Re-read it and ` +
        `update DUPLICATED_VALUES; a probe that silently stopped splicing would report a number ` +
        `for a statement nobody ran.`
    )
  }
  fs.writeFileSync(DERIVED_INDEXER, src.replace(DUPLICATED_VALUES, DUPLICATED_VALUES.split("\n")[0] + "\n"))
  const derived: any = await import(pathToFileURL(DERIVED_INDEXER).href)
  return { run: derived.indexProjectParallel, cleanup: () => { try { fs.rmSync(DERIVED_INDEXER, { force: true }) } catch {} } }
}

function collect(dir: string, out: string[], cap: number): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= cap) return out
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collect(p, out, cap)
    else if (e.name.endsWith(".proto")) out.push(p)
  }
  return out
}

async function main(): Promise<void> {
  if (!fs.existsSync(SRC)) {
    console.log(`SKIP: ${SRC} is not on disk. Stage it per script/m14/tmp/protobuf/corpus-manifest.json.`)
    console.log("A gate that skips loudly is honest; one that reports a number from a corpus it did not read is not.")
    process.exit(0)
  }

  const picked = collect(SRC, [], N)
  if (picked.length === 0) {
    console.log(`SKIP: no .proto under ${SRC}`)
    process.exit(0)
  }

  // A scratch project holding COPIES, so the corpus is read-only to this probe and
  // the store's file walk sees exactly the files this probe chose.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-store-"))
  for (const f of picked) fs.copyFileSync(f, path.join(root, path.basename(f)))
  const staged = fs.readdirSync(root).filter((n) => n.endsWith(".proto"))

  const projectId = getProjectId(root)
  let indexer: ReturnType<typeof loadIndexer> | null = null
  try {
    indexer = await loadIndexer()
    await indexer.run(projectId, root, {})

    const db: any = await BrainDatabase.getRawInstance(projectId)

    const sym = db
      .prepare(
        `SELECT COUNT(*) AS n,
                SUM(CASE WHEN qualified_name IS NULL OR qualified_name = '' THEN 1 ELSE 0 END) AS blankQ,
                SUM(CASE WHEN qualified_name = name THEN 1 ELSE 0 END) AS qEqualsName
           FROM brain_symbol WHERE project_id = ?`
      )
      .get(projectId)

    // BOUND is not CORRECT. The store binds a target it cannot match exactly by
    // LEAF name, first-wins (`extractLeaf` + `nameToSymbol` at
    // src/ast/parallel-indexer.ts:3379-3393). So an edge can bind and still land on
    // a declaration the edge never named. Two columns separate the two questions:
    //
    //   EXACT   — the bound symbol's qualified_name EQUALS the edge's target string.
    //             This is the only form of "bound to the right declaration" the store
    //             can prove, and it is what strategy 1 (target_external =
    //             qualified_name) buys when the analyzer publishes a qualified id.
    //   LEAF>1  — the target's LAST dot segment is declared by more than one symbol
    //             in the project, so first-wins chose. `>1 FILE` is the shape that
    //             sends an inbound edge to another file's declaration.
    const edges: any[] = db
      .prepare(
        `SELECT r.relationship_type AS t, r.target_external AS tgt, r.target_symbol_id AS tid,
                r.id AS rid, r.source_external AS sext, r.metadata AS rmeta, r.line_number AS rline, r.confidence AS rconf,
                ts.qualified_name AS tq, sf.relative_path AS sfile, tf.relative_path AS tfile
           FROM brain_relationship r
           LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
           LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
           LEFT JOIN brain_file sf ON sf.id = ss.file_id
           LEFT JOIN brain_file tf ON tf.id = ts.file_id
          WHERE r.project_id = ?`
      )
      .all(projectId)

    // Deliverable C: a target that binds to nothing must be separated into
    // EXTERNAL (no declaration in this project publishes it) and NEVER-INDEXED (a
    // declaration exists under a different spelling). They look identical in a
    // count and are opposite findings, so both are counted.
    const byQualified = new Set<string>()
    const byName = new Map<string, { n: number; files: Set<string> }>()
    for (const r of db.prepare(`SELECT name, file_id, qualified_name FROM brain_symbol WHERE project_id = ?`).all(projectId) as any[]) {
      byQualified.add(String(r.qualified_name ?? ""))
      const e = byName.get(r.name) ?? { n: 0, files: new Set<string>() }
      e.n++
      e.files.add(r.file_id)
      byName.set(r.name, e)
    }
    const leaf = (t: string | null): string => {
      if (!t) return ""
      const noLine = t.replace(/:\d+$/, "")
      const seg = noLine.split(":").pop() ?? ""
      return seg.split(".").pop() ?? ""
    }

    // A STORE-GENERATED row is not an analyzer edge, and averaging the two would
    // misreport this lane. `src/ast/parallel-indexer.ts:3137` synthesises one
    // `contains` edge per (owner, owned) symbol pair from `ownerName`, with
    // `target_symbol_id` bound BY CONSTRUCTION and `target_external` set to the
    // bare `symbol.name`. Every analyzer edge this lane emits carries
    // `metadata.evidenceClass` (see `evidenceClassFor` in the analyzer), and no
    // synthesised row does — that is the discriminator, and it is read off the row
    // rather than inferred from a count.
    const isStoreGenerated = (e: any): boolean => {
      if (!e.rmeta) return false
      try {
        return typeof JSON.parse(e.rmeta).evidenceClass !== "string"
      } catch {
        return false
      }
    }

    const perType = new Map<string, { n: number; bound: number; exact: number; amb: number; ambCrossFile: number; otherFile: number; auto: number; autoBound: number; ext: number }>()
    for (const e of edges) {
      const row = perType.get(e.t) ?? { n: 0, bound: 0, exact: 0, amb: 0, ambCrossFile: 0, otherFile: 0, auto: 0, autoBound: 0, ext: 0 }
      const auto = isStoreGenerated(e)
      if (auto) row.auto++
      if (!auto) {
        row.n++
        if (e.tid) {
          row.bound++
          if (e.tq && e.tq === e.tgt) row.exact++
          if (e.tfile && e.sfile && e.tfile !== e.sfile) row.otherFile++
        }
        if (e.tgt && !byQualified.has(e.tgt) && !byName.has(e.tgt)) row.ext++
        const cand = byName.get(leaf(e.tgt))
        if (cand && cand.n > 1) {
          row.amb++
          if (cand.files.size > 1) row.ambCrossFile++
        }
      } else if (e.tid) {
        row.autoBound++
      }
      perType.set(e.t, row)
    }
    const autoTotal = edges.filter(isStoreGenerated).length
    const sourceBoundTotal = (db
      .prepare(`SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ? AND source_symbol_id IS NOT NULL`)
      .get(projectId) as any).c

    const typeRows = [...perType.entries()]
      .map(([t, r]) => ({ t, ...r }))
      .sort((a, b) => b.n - a.n)
    const walkable = typeRows.reduce((a, r) => a + r.bound, 0)
    const exact = typeRows.reduce((a, r) => a + r.exact, 0)
    const total = typeRows.reduce((a, r) => a + r.n, 0)

    console.log(`store-binding: ${staged.length} .proto files from ${SRC}`)
    console.log(`project ${projectId}`)
    console.log(
      `symbols ${sym.n}   blank qualified_name ${sym.blankQ}   qualified_name == bare name ${sym.qEqualsName} (${((sym.qEqualsName / sym.n) * 100).toFixed(1)}%)`
    )
    console.log("")
    console.log("ANALYZER-EMITTED EDGES ONLY — the store's own synthesised containment is excluded and counted separately")
    console.log("")
    console.log("type          edges   BOUND   BOUND==exact   EXTERNAL   leaf>1decl   leaf>1file   target other file")
    console.log("-------------------------------------------------------------------------------------------------------------")
    for (const r of typeRows) {
      console.log(
        `${String(r.t).padEnd(13)}${String(r.n).padEnd(8)}${String(r.bound).padEnd(8)}${(r.exact + "/" + r.n).padEnd(15)}${String(r.ext).padEnd(11)}${String(r.amb).padEnd(13)}${String(r.ambCrossFile).padEnd(13)}${r.otherFile}`
      )
    }
    console.log("--------------------------------------------------------------------------------------------------")
    console.log(`TOTAL ${total} analyzer edges, ${walkable} walkable BACK to a declaration (${((walkable / total) * 100).toFixed(2)}%), ${exact} of them PROVABLY the one named (${((exact / total) * 100).toFixed(2)}%)`)
    const analyzerEdges = edges.filter((e) => !isStoreGenerated(e))
    const analyzerSrcBound = analyzerEdges.filter((e) => e.sfile !== null && e.sfile !== undefined).length
    console.log(`source bound on ${analyzerSrcBound} of ${total} analyzer edges (a NULL source_external is an edge the store could not attribute to a symbol)`)
    void sourceBoundTotal
    console.log("")
    console.log(`store-generated containment rows (NOT this lane's, bound by construction): ${autoTotal}, bound ${autoTotal - typeRows.reduce((a, r) => a + r.auto - r.autoBound, 0)}`)
    console.log("")
    console.log("BOUND is not CORRECT. The store falls back to the target's LAST dot segment, first-wins,")
    console.log("so BOUND can be a declaration the edge never named. BOUND==exact is the only provable form,")
    console.log("and it is what publishing a qualified id buys: strategy 1 matches target_external = qualified_name.")

    // `--dump-mismatch N` prints N bound-but-not-exact edges per type. A rate with no
    // examples is a rate nobody can check, and the reason a `contains` edge misses is
    // not visible in the rate at all.
    const dump = argInt("--dump-mismatch", 0)
    if (dump > 0) {
      console.log("")
      console.log(`bound-but-not-exact samples (up to ${dump} per type):`)
      for (const r of typeRows) {
        const bad = edges.filter((e) => e.t === r.t && !isStoreGenerated(e) && e.tid && !(e.tq && e.tq === e.tgt))
        if (bad.length === 0) continue
        console.log(`  ${r.t}: ${bad.length} of ${r.n}`)
        for (const e of bad.slice(0, dump)) {
          console.log(`    target_external=${JSON.stringify(e.tgt)}  row-id=${JSON.stringify(e.rid)}`)
          console.log(`      line=${e.rline} conf=${e.rconf} meta=${String(e.rmeta).slice(0, 160)}`)
          console.log(`      bound to qualified_name=${JSON.stringify(e.tq)} name-leaf=${JSON.stringify(leaf(e.tq))} file=${e.tfile} (edge source file ${e.sfile})`)
        }
      }
    }
  } finally {
    try { indexer?.cleanup() } catch {}
    try {
      fs.rmSync(root, { recursive: true, force: true })
    } catch {}
    try {
      fs.rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
    } catch {}
  }
}

main().catch((e) => {
  console.error("store-binding failed:", e?.message ?? e)
  process.exit(1)
})
