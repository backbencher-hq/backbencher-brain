/**
 * PY-35 — the python STORE SEAM: is the hierarchy this lane publishes the hierarchy the
 * store holds, and which label does each base carry?
 *
 * WHY THIS GATE EXISTS, AND WHY IT IS NOT A FIXTURE. `python/implements-interface-bases`
 * and every other fixture in this folder read `ASTEngine.parseFile`'s SYMBOLS AND
 * RELATIONSHIPS. That is the near side of a seam. On the far side sits
 * `src/ast/pool-worker.ts`, whose per-symbol `metadata` is a narrow per-language ALLOWLIST
 * ("only keys a READER CONSUMES belong here"), and a key that is missing from it is dropped
 * for every symbol in every language with no error anywhere. php is the measured precedent:
 * its analyzer published `metadata.superTypes` on 8 of 8 class-like symbols while the store
 * held the column on 0, and `script/m60/php-store-pipeline-seam.ts` is what found it — the
 * one-key widening in `pool-worker.ts:1272` is that gate's fix, and it is language-agnostic
 * (kotlin, scala, php and the rest publish this exact key).
 *
 * python played the other half of the same story: it published `metadata.baseClasses` and
 * NOT `superTypes`, so every python class had a NULL heritage column — the column
 * `member-owner-resolution` walks its ancestor frontier from, `override-retarget` refuses to
 * run without (`if (supertypes.size === 0) return out`), and `schema-ddl.ts` documents as
 * "the type hierarchy each symbol extends/implements". A gate that reads only parseFile
 * cannot see the difference between a populated column and a dropped key, which is exactly
 * why php's defect survived its own fixtures.
 *
 * PY-34 (ruled 2026-10-09) fixed the other half of this: a proven interface base publishes
 * ONE relationship (`implements`, the most specific true label) and the inheritance fact
 * lives in this column instead. So there are two claims to measure, and both are here:
 *
 *   A  ANALYZER CARRIES the full base list as `metadata.superTypes` — measured with
 *      `ASTEngine.parseFile`, the analyzer entry the fixtures use. NOT with `parseFile` from
 *      `pool-worker.ts`: that returns the PROJECTED object, so measuring with it would make
 *      the control part of the thing under test (php's gate records the same mistake, made
 *      once, reading "analyzer carries 0" while its own payload fixture pinned 8).
 *   B  STORE CARRIES `brain_symbol.super_types`, through `indexProjectParallel` — the REAL
 *      pipeline, worker pool included — and the INTERFACE base is in it. That is the claim
 *      the ruling rests on: the parent of a class whose edge is spelled `implements` is
 *      still walkable, because the column that exists to be walked is not the edge label.
 *   C  ONE LABEL is still one label, and the label is the most specific TRUE one: `implements
 *      Base -> ABC` (tier 0, stdlib marker) and `implements Child -> Base` (TIER 1: `Child`'s
 *      base `Base` declares an interface in its own header), against `extends UserRepo ->
 *      Repository` across files, where `Repository` is an ordinary class and nothing in its
 *      header says otherwise. The two halves are asserted together so that "close the
 *      heritage gap" cannot be satisfied by re-introducing the additive `extends` edge the
 *      ruling removed — and the `Child` row is asserted as `implements` for the same reason:
 *      the ruling's tier 1 is transitivity (python has no separate interface construct, so a
 *      subclass of an interface-declaring class is a conformance edge, `python/interface-
 *      implements`'s `Service -> Repository` row), and a gate that expected `extends` here
 *      would have re-legalised the additive reading one tier down.
 *
 *      A NOTE ON UNRESOLVED TARGETS: `ABC` is stdlib, so it is never a `brain_symbol` in this
 *      project and `target_symbol_id` is NULL. The store keeps the spelling in
 *      `target_external`, which is what this gate reads (`COALESCE(t.name, r.target_external)`);
 *      reading only the join would call a correctly-named edge "missing".
 *
 * D  THE OWNER CHANNEL through the REAL pipeline. THIS SECTION REPLACED A REPORTED-NOT-SCORED
 *    ROW that said python publishes no relation-level `owner` channel. IT NOW DOES
 *    (`real-python-analyzer.ts` `memberOwnerOf`, published on the member edges whose receiver
 *    is exactly `self`/`cls`), so the ancestor lever php built (PHPD42) reaches this lane's
 *    rows through the language-agnostic `member-owner-resolution` pass. Two claims, both
 *    measured end-to-end through `indexProjectParallel`: `Child.use`'s `self.kind()` resolves
 *    to the class that DECLARES it, and `UserRepo.read_all`'s `self.record` resolves to
 *    `Repository`'s own attribute — in ANOTHER FILE (base.py), so that row binds only if the
 *    `super_types` ancestor walk crosses files. The pass's contract IN ISOLATION, with the two
 *    signal controls (no `owner` / no `super_types`), is `python/owner-resolution-gate.mts`.
 *
 * Usage: bun validation/m14/fixtures/python/store-heritage-seam.mts
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..")

const BASE_PY = `"""A concrete in-file base, read across files by the subclass below."""


class Repository:
    def __init__(self):
        self.record = None

    def save(self, record):
        self.record = record
        return self.record

    def read(self):
        return self.record
`

const IMPL_PY = `from abc import ABC

from base import Repository


class Base(ABC):
    """The base's EDGE is \\\`implements\\\` — ABC is proven an interface — and the heritage
    column must still carry ABC, or the parent is unreachable for every consumer."""

    def kind(self):
        return "base"


class Child(Base):
    """Tier 1: an in-file base whose own header declares an interface."""

    def kind(self):
        return "child"

    def use(self):
        return self.kind()


class UserRepo(Repository):
    """A CONCRETE base, read from another file: the ordinary case, and the one whose
    column entry must not be lost while interface bases are being handled."""

    def read_all(self):
        return self.record
`

interface Problem {
  id: string
  detail: string
}
const problems: Problem[] = []
const fail = (id: string, detail: string): void => {
  problems.push({ id, detail })
}

async function main(): Promise<void> {
  const data = mkdtempSync(path.join(tmpdir(), "py-seam-data-"))
  process.env.BB_DATA_DIR = data
  const project = mkdtempSync(path.join(tmpdir(), "py-seam-proj-"))
  const srcDir = path.join(project, "src")
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(path.join(srcDir, "base.py"), BASE_PY)
  writeFileSync(path.join(srcDir, "impl.py"), IMPL_PY)

  console.log("python store seam (production path)")
  console.log(`  project: ${project}`)

  // ---- A. what the ANALYZER publishes, projection bypassed -------------------
  const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any
  const analyzerSuper = new Map<string, string[]>()
  for (const f of ["base.py", "impl.py"]) {
    const abs = path.join(srcDir, f)
    const r = await ASTEngine.parseFile(abs, readFileSync(abs, "utf8"))
    for (const s of r.symbols ?? []) {
      const sup = s.metadata?.superTypes
      if (Array.isArray(sup) && sup.length > 0) analyzerSuper.set(`${f}:${s.name}`, sup)
    }
  }
  const need = [
    ["impl.py:Base", ["ABC"]],
    ["impl.py:Child", ["Base"]],
    ["impl.py:UserRepo", ["Repository"]],
    ["base.py:Repository", []],
  ] as const
  for (const [key, want] of need) {
    const got = analyzerSuper.get(key)
    if (!got) {
      if (want.length > 0) fail("A-analyzer-carries", `${key} publishes no metadata.superTypes (want ${JSON.stringify(want)})`)
      continue
    }
    const missing = want.filter((w) => !got.includes(w))
    if (missing.length > 0) fail("A-analyzer-carries", `${key} superTypes=${JSON.stringify(got)} is missing ${JSON.stringify(missing)}`)
  }
  console.log(`  A  analyzer carries superTypes on ${analyzerSuper.size} class-like symbol(s): ${[...analyzerSuper.entries()].map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")}`)

  // ---- B/C. what the STORE keeps, through the REAL pipeline ------------------
  const { getProjectId } = (await import(path.join(ROOT, "src/cli/index.ts"))) as any
  const { indexProjectParallel } = (await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))) as any
  const { BrainDatabase } = (await import(path.join(ROOT, "src/brain/database.ts"))) as any
  const pid = getProjectId(project) as any
  try {
    await indexProjectParallel(pid, project, {})
  } catch (e) {
    console.error(`the production index did not complete: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`)
    process.exit(1)
  }

  const db = await BrainDatabase.getRawInstance(pid)
  const symbols = db
    .prepare(`SELECT name, qualified_name, symbol_type, super_types FROM brain_symbol WHERE project_id = ?`)
    .all(pid) as any[]
  const storeSuper = new Map<string, string[]>()
  for (const s of symbols) {
    if (typeof s.super_types !== "string" || s.super_types.length === 0) continue
    try {
      const arr = JSON.parse(s.super_types)
      if (Array.isArray(arr) && arr.length > 0) storeSuper.set(String(s.name), arr.map(String))
    } catch { /* a malformed column is reported by the assertion below, not swallowed */ }
  }
  for (const [key, want] of need) {
    if (want.length === 0) continue
    const name = key.split(":")[1]
    const got = storeSuper.get(name)
    if (!got) {
      fail("B-store-carries", `brain_symbol.super_types is NULL/empty for ${key} (want ${JSON.stringify(want)})`)
      continue
    }
    const missing = want.filter((w) => !got.includes(w))
    if (missing.length > 0) fail("B-store-carries", `${key} super_types=${JSON.stringify(got)} is missing ${JSON.stringify(missing)}`)
  }
  console.log(`  B  store holds super_types on ${storeSuper.size} of ${symbols.length} symbol(s): ${[...storeSuper.entries()].map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")}`)

  const edges = db
    .prepare(
      `SELECT r.relationship_type AS t, s.name AS src,
              COALESCE(t.name, r.target_external) AS tgt
         FROM brain_relationship r
         LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
         LEFT JOIN brain_symbol t ON t.id = r.target_symbol_id
        WHERE r.project_id = ? AND r.relationship_type IN ('extends','implements')`,
    )
    .all(pid) as any[]
  const has = (t: string, src: string, tgt: string): boolean =>
    edges.some((e) => e.t === t && (e.src === src || String(e.src ?? "").endsWith(`.${src}`)) && (e.tgt === tgt || String(e.tgt ?? "").endsWith(`.${tgt}`)))
  for (const want of [
    ["implements", "Base", "ABC"],
    ["implements", "Child", "Base"],
    ["extends", "UserRepo", "Repository"],
  ] as const) {
    if (!has(want[0], want[1], want[2])) fail("C-one-label", `missing ${want[0]} ${want[1]} -> ${want[2]}`)
  }
  for (const forbid of [
    ["extends", "Base", "ABC"],
    ["extends", "Child", "Base"],
  ] as const) {
    if (has(forbid[0], forbid[1], forbid[2])) {
      fail("C-one-label", `${forbid[0]} ${forbid[1]} -> ${forbid[2]} is present: the additive edge the 2026-10-09 ruling removed`)
    }
  }
  console.log(`  C  heritage edges: ${JSON.stringify(edges.map((e) => `${e.t} ${e.src} -> ${e.tgt}`))}`)

  // ---- D. the OWNER CHANNEL, measured end-to-end through the REAL pipeline ----
  //
  // `metadata.owner` on the relation and `super_types` on the symbol are the two signals
  // `member-owner-resolution` reads, and BOTH have to survive the pipeline for a row to
  // resolve. `Child.use`'s `self.kind()` is the DIRECT case (the receiver's own class declares
  // it); `UserRepo.read_all`'s `self.record` is the INHERITED one, and it is the load-bearing
  // row because `record` is declared on `Repository` in base.py — a DIFFERENT FILE — so it
  // binds only if the ancestor walk crosses files.
  const memberRows = db
    .prepare(
      `SELECT r.relationship_type AS t, s.name AS src,
              COALESCE(tg.name, r.target_external) AS tgt,
              os.name AS owner_name, f.relative_path AS owner_file, r.metadata AS md
         FROM brain_relationship r
         LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
         LEFT JOIN brain_symbol tg ON tg.id = r.target_symbol_id
         LEFT JOIN brain_symbol os ON os.id = tg.owner_symbol_id
         LEFT JOIN brain_file f ON f.id = os.file_id
        WHERE r.project_id = ? AND r.relationship_type IN ('calls','uses')`,
    )
    .all(pid) as any[]
  const hasOwner = (r: any): boolean => {
    try { return typeof JSON.parse(String(r.md ?? "{}")).owner === "string" } catch { return false }
  }
  const published = memberRows.filter(hasOwner)
  const findRow = (t: string, src: string, tgt: string): any =>
    memberRows.find((r: any) => r.t === t && String(r.src ?? "").endsWith(src) && String(r.tgt ?? "").endsWith(tgt))
  const directRow = findRow("calls", "use", "kind")
  const inheritedRow = findRow("uses", "read_all", "record")
  if (!(published.length > 0)) {
    fail("D-owner-published", `no calls/uses row carries metadata.owner through the pipeline (the channel did not survive: ${memberRows.length} member rows)`)
  }
  if (!directRow) {
    fail("D-direct", "no `calls Child.use -> kind` row in the store")
  } else if (!(directRow.owner_name === "Child" && String(directRow.owner_file ?? "").endsWith("impl.py"))) {
    fail("D-direct", `Child.use -> kind landed on ${directRow.owner_name ?? "NULL"}@${directRow.owner_file ?? "NULL"} (want Child@impl.py)`)
  }
  if (!inheritedRow) {
    fail("D-inherited", "no `uses UserRepo.read_all -> record` row in the store")
  } else if (!(inheritedRow.owner_name === "Repository" && String(inheritedRow.owner_file ?? "").endsWith("base.py"))) {
    fail("D-inherited", `UserRepo.read_all -> record landed on ${inheritedRow.owner_name ?? "NULL"}@${inheritedRow.owner_file ?? "NULL"} (want Repository@base.py — a CROSS-FILE ancestor walk)`)
  }
  console.log(`  D  owner-carrying member rows through the pipeline: ${published.length} of ${memberRows.length}`)
  console.log(`     DIRECT    calls Child.use -> kind      landed on ${directRow ? `${directRow.owner_name}@${directRow.owner_file}` : "MISSING"}`)
  console.log(`     INHERITED uses UserRepo.read_all -> record  landed on ${inheritedRow ? `${inheritedRow.owner_name}@${inheritedRow.owner_file}` : "MISSING"}`)

  if (problems.length > 0) {
    console.log(`\nFAIL — ${problems.length} seam problem(s):`)
    for (const p of problems) console.log(`   ${p.id}: ${p.detail}`)
    process.exitCode = 1
    return
  }
  console.log(`\nPASS — A analyzer carries, B store carries (interface base included), C one label per base, D the owner channel resolves (cross-file ancestor walk included)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
