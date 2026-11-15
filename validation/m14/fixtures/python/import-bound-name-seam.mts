/**
 * PY-D13 (round 8) — THE IMPORT BOUND NAME ACROSS THE STORE SEAM: does the alias this lane
 * publishes reach `brain_import`, and can the store use it?
 *
 * WHY THIS GATE EXISTS. Round 7 published the bound name of an aliased import on the `imports`
 * RELATION (`metadata.importedAs`), and the resolution verdict reads it. Everything in this
 * folder measures the NEAR side of that seam — `ASTEngine.parseFile`'s symbols, relationships
 * and imports. On the far side sit two things this lane does not own:
 *
 *   `src/ast/pool-worker.ts` projected each analyzer ImportInfo into `{name, path, type,
 *   isExternal, line}`. The BOUND NAME was not in that projection, so it was dropped for every
 *   language with no error — the same shape as php's PHPD41 (`metadata.superTypes` published on
 *   8 of 8 class-like symbols while the store held the column on 0 of 4,940).
 *
 *   `src/ast/parallel-indexer.ts` reads `imp.alias ?? imp.localName` and
 *   `imp.importType ?? (…isNamespace… ? "namespace" : "named")`. The first read had no writer on
 *   the AST path: the projection emitted neither key. Both files' own comments said the plumbing
 *   was intended ("the AST path publishes the same pair via ImportInfo.alias"; "the alias the
 *   analyzers already publish on ImportInfo.alias / ImportInfo.localName, and which
 *   brain_import.imported_as has carried in the DDL and the TS type since before either had a
 *   writer").
 *
 * WHAT ROUND 17 CHANGED, AND WHY THIS GATE IS NOW A POSITIVE PIN. The projection emits `alias`,
 * and the python analyzer publishes the per-item binding of a from-import on the ROW the seam
 * reads (`ImportInfo.itemBindings`, `[{name, as}]`) — so `brain_import.imported_as` is WRITTEN on
 * the AST path for the first time, and B asserts the value instead of pinning its absence. The
 * gate kept the shape that made the fix possible: while the gap was open, B pinned the CURRENT
 * value BY NAME (the precedent `php/owner-resolution-gate.mts` set) so the scope was visible in a
 * gate rather than asserted absent in a paragraph, and the landing of the shared fix turned it RED
 * and named the flipped claim — which is exactly what happened, and is why the assertions below
 * are written against `t` / `PV` / `v` rather than against NULL. Three facts are pinned, in three
 * directions, because a column with one writer can be wrong in three ways: the two shapes must
 * CARRY the binding, a plain import must KEEP NULL (the over-claim direction, and the reading that
 * `patterns.ts` depends on), and the classification that is STILL dropped stays visible.
 *
 *   A  the ANALYZER carries the binding — `ImportInfo.alias` for `import X as Y`, the
 *      `imports` relation's `metadata.importedAs` for the `from X import Z as W` shape (whose
 *      binding was lost one layer deeper until round 7, because the item list kept only the
 *      IMPORTED name), and since round 17 the same from-import ROW's `itemBindings`. GREEN.
 *   B  the STORE holds it — measured through `indexProjectParallel`, the real pipeline, worker
 *      pool included. ASSERTS: `imported_as` is `t` for the namespace import and `PV` / `v` for
 *      the two from-imports, NULL for the plain `import os`, and `import_type` is still `named`
 *      (the classification the projection genuinely does not carry — see the remaining half
 *      below, which is pinned here so it cannot drift unseen).
 *   C  THE CONTROL THAT MAKES B MEAN SOMETHING — an ordinary in-population bare base DOES
 *      resolve to a `brain_symbol` through the same pipeline. Without this row, B's NULL could
 *      be a broken harness rather than a seam. GREEN.
 *   D  the ROUTE — two references to the SAME leaf through two DIFFERENT alias-bound modules
 *      (`models_alias.ProductVariant` and `v.ProductVariant`) resolve to the SAME symbol, which
 *      is only possible because nothing on the store side reads the route. The reason is NOT the
 *      alias: NOTHING OUTSIDE THE ANALYZERS READS RELATION-LEVEL `metadata.qualified`
 *      (`grep -rn "\.qualified\b" src/ --include=*.ts` minus `src/ast/real-*` and
 *      `qualifiedName`/`qualifiedCalls` returns nothing), so the store's strategies —
 *      qualified_name exact, unique name, dotted SUFFIX, `module:item`, and strategy 3c's
 *      RANKING of dotted candidates — all answer from `target_external`, the leaf. Publishing the
 *      alias without a route consumer therefore buys DATA FIDELITY (`patterns.ts` computes
 *      `usedName = imported_as || imported_name`, so 35.9% of python import specifiers are
 *      searched for by a name the file never writes), NOT resolution.
 *   E  the WORKER PROJECTION's two roles for `X as Y` — `name` is what the source module declares,
 *      `alias` what this file binds — asserted on a TYPESCRIPT import, because the projection is
 *      shared and the bug this check pins was not python's: it read the BOUND name into BOTH
 *      fields, so `import { A as B } from "./a"` reached the indexer as `{name:"B", alias:"B"}`
 *      and `imported_name` and `imported_as` were the same string in the store. GREEN.
 *   F  THE ROW MODEL — the store keeps EVERY item of a multi-item statement, not just the last.
 *      The projection is per ITEM and the store's id was per STATEMENT (`module:line`), so
 *      `INSERT OR REPLACE` overwrote every earlier item of a statement with the next one. Two
 *      statements in the fixture are built so the pin can only pass one way: `marker_one as m1,
 *      marker_two` (the ALIASED item FIRST — the direction the old id destroyed) and `marker_three,
 *      marker_four as m4` (the aliased item last). Measured over 2,000 corpus files: 11,903 item
 *      rows projected, 8,903 written. GREEN.
 *   G  THE TWO ITEM CLASSES THAT NEVER REACHED A ROW — asserted through the same real pipeline.
 *      G1: `from __future__ import annotations` (a node type of its own, whose module the grammar
 *      does not expose as a named child) now reaches a row. G2: `from clock import clock` — the
 *      module and the item are the same word, and the item loop used to skip the module BY TEXT, so
 *      the item was dropped; a real module the project declares makes the EDGE the discriminating
 *      channel here, since the ROW existed either way (the projection falls back to the module when
 *      the item list is empty). GREEN.
 *
 * THE FIRST TWO D PINS WERE WRONG, AND THE SHAPE OF THE THIRD IS THE LESSON. Kept visible because
 * the mistake is the instrument's whole justification. Pin 1 pointed the route at the ONE class the
 * project declares: the leaf was project-unique, the leaf FALLBACK bound it
 * (`resolveTargetStmt.get(…, targetName, …) ?? resolveTargetStmt.get(…, targetLeaf, …)`,
 * `parallel-indexer.ts:~4466`), the row came out RESOLVED and the pin read FLIPPED — which said
 * nothing about routes, because a unique leaf resolves whatever the route says. Pin 2 declared the
 * leaf TWICE, expecting ambiguity to force a decline; also wrong, because strategy 3c RANKS dotted
 * candidates and takes the best, so an ambiguous leaf resolves too, silently. Both pins asked a
 * one-row question that had more than one cause. The rule this folder now follows: A PIN THAT
 * ASSERTS "THE ROUTE WAS NOT USED" MUST OBSERVE TWO ROUTES THAT WOULD GIVE DIFFERENT ANSWERS. That
 * is what D does — same leaf, different route, one target — and the CONTROL moved to a name the
 * project declares exactly once (`Sku`), so C still proves this pipeline can resolve at all.
 *
 * WHAT ROUND 17 DID NOT TAKE, enumerated rather than waved at — and this list is SHORTER than the
 * one it replaces, which is the point of keeping it:
 *   1. THE CLASSIFICATION IS STILL DROPPED, and deliberately. `real-python-analyzer.ts` publishes
 *      `isNamespace: true` on its `from X import Y` rows; the indexer's fallback reads
 *      `isNamespace`, so passing the analyzer's `importType` through would have to decide what
 *      those values MEAN — `brain.sql.ts` documents `import_type` as a four-term vocabulary
 *      (`default`, `named`, `namespace`, `side_effect`) while ten other lanes declare
 *      `make_include`, `include`, `sql_extension`, `java-module-requires`, … A stored `namespace`
 *      for every python from-import would replace one wrong value with another, and the honest fix
 *      is a vocabulary decision on a shared contract, not a plumbing widen. B pins the current
 *      value (`named`) so the deferral cannot drift unseen.
 *   2. ALL BUT ONE ITEM OF A MULTI-ITEM STATEMENT ARE STILL OUT OF REACH, with a price, and with
 *      the row semantics MEASURED rather than assumed: the indexer's row id is
 *      `${fileId}:import:${moduleName}:${line}` — one row per STATEMENT — while the projection
 *      hands it one row per ITEM, and the statement is `INSERT OR REPLACE`, so the LAST item of a
 *      statement is the one that survives. `from m import fixture, Sku as SKU2` therefore stores
 *      `SKU2`, while `from m import Sku as SKU, fixture` stores `fixture` and loses the binding —
 *      which is why this is pinned in both directions by the probe
 *      `.tmp-py/probe-import-rows.mts` and not reasoned about. Measured over the python population
 *      (`.tmp-py/price-last-item-wins.py`): of 3,333 aliased statements whose binding CAN reach the
 *      store (2,893 single-item, 20 aliased-last, 420 `import X as Y`), **6 cannot** — the aliased
 *      item is not last, and the six files are named by the price. An earlier price this round
 *      (`.tmp-py/price-import-alias-seam.py`) bucketed by FIRST-vs-LATER and is SUPERSEDED: the row
 *      semantics it assumed are the opposite of the measured ones.
 *   3. THE SURFACE IS SHARED, and that is now a measured statement rather than a caution: the
 *      widen is additive — it can only affect a row whose analyzer publishes the key — and the
 *      same price counted **41,560** python rows where NULL stays the correct value. Typescript
 *      publishes `ImportInfo.alias` too, so its stored rows move with this change and are the
 *      reason this is a shared edit rather than a lane-local one.
 *
 * Usage: bun validation/m14/fixtures/python/import-bound-name-seam.mts
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..")

const MODELS_PY = `"""A module the project declares."""


class ProductVariant:
    def __init__(self):
        self.sku = None

    def label(self):
        return "variant"


class Sku:
    """CONTROL: this name is declared exactly ONCE in the project, so a bare base can resolve."""
`

// Deliberately declares the SAME leaf name in a second module. `ProductVariant` therefore has two
// candidates and NO name strategy can choose between them — the state in which the route D pins is
// the only thing that could answer, and does not.
const VENDOR_PY = `"""A vendored copy that collides with models.ProductVariant on purpose."""


class ProductVariant:
    def __init__(self):
        self.vendor_sku = None
`

// TYPESCRIPT, for the SECOND half of the projection widen. The `X as Y` shape is not python-only,
// and the projection's own bug was here: it read the BOUND name into `name` AND `alias`, so
// `import { A as B } from "./a"` reached the indexer as `{name:"B", alias:"B"}` and the imported
// `A` was nowhere on the row. Two roles, two fields, asserted in check E.
// ROUND 18, check G2's shape: a module whose name IS the item name. `from clock import clock` is the
// smallest statement on which a text-based module skip and a node-based one disagree, and it needs a
// module the project declares so the EDGE is observable in the store rather than only on the payload.
const CLOCK_PY = `"""A module whose name is also the name of the thing importers bind out of it."""


class clock:
    def now(self):
        return 0
`

const A_TS = `export const A = 1\n`
const MAIN_TS = `import { A as B } from "./a"\nimport { C } from "./a"\n\nconsole.log(B, C)\n`

const APP_PY = `from __future__ import annotations

import typing as t
import os

from models import ProductVariant
from models import ProductVariant as PV
from models import Sku
import models as models_alias
import vendor as v

# CHECK F: two multi-item statements, in both orders. The ALIASED item is FIRST in one and LAST in
# the other, so a pin that only ever looked at the alias would pass on the second statement alone
# while the first one's binding was being overwritten.
from models import marker_one as m1, marker_two
from models import marker_three, marker_four as m4

# CHECK G2: module name == item name — the one shape a text-based module skip cannot keep.
from clock import clock


class Plain(Sku):
    """CONTROL: a bare base the project declares ONCE — this one resolves through the store."""


class Aliased(PV):
    """CLOSED IN ROUND 17: the base is bound by \`as\`; the store's row now carries \`imported_as="PV"\`."""


def via_models(x: models_alias.ProductVariant):
    """ROUTE 1: the type named through the alias bound to \`models\`."""
    return None


def via_vendor(x: v.ProductVariant):
    """ROUTE 2: the type named through the alias bound to \`vendor\`."""
    return None
`

interface Problem { id: string; detail: string }
const problems: Problem[] = []
const fail = (id: string, detail: string): void => { problems.push({ id, detail }) }

const note: string[] = []

async function main(): Promise<void> {
  const data = mkdtempSync(path.join(tmpdir(), "py-alias-seam-data-"))
  process.env.BB_DATA_DIR = data
  const project = mkdtempSync(path.join(tmpdir(), "py-alias-seam-proj-"))
  const srcDir = path.join(project, "src")
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(path.join(srcDir, "models.py"), MODELS_PY)
  writeFileSync(path.join(srcDir, "vendor.py"), VENDOR_PY)
  writeFileSync(path.join(srcDir, "clock.py"), CLOCK_PY)
  writeFileSync(path.join(srcDir, "app.py"), APP_PY)
  writeFileSync(path.join(srcDir, "a.ts"), A_TS)
  writeFileSync(path.join(srcDir, "main.ts"), MAIN_TS)

  console.log("python import-bound-name seam (production path)")
  console.log(`  project: ${project}`)

  // ---- A. what the ANALYZER publishes, projection bypassed -------------------
  const { ASTEngine } = (await import(path.join(ROOT, "src/ast/engine.ts"))) as any
  const appAbs = path.join(srcDir, "app.py")
  const app = await ASTEngine.parseFile(appAbs, readFileSync(appAbs, "utf8"))

  const nsImport = (app.imports ?? []).find((i: any) => i.module === "typing" && i.alias === "t")
  if (!nsImport) {
    fail("A-analyzer-carries", "`import typing as t` does not publish ImportInfo.alias === \"t\" on the analyzer's own imports")
  }
  const vendorImport = (app.imports ?? []).find((i: any) => i.module === "vendor" && i.alias === "v")
  if (!vendorImport) {
    fail("A-analyzer-carries", "`import vendor as v` (the route D pins) does not publish ImportInfo.alias === \"v\"")
  }
  const relBindings = new Map<string, string>()
  for (const r of app.relationships ?? []) {
    if (r.type !== "imports") continue
    const as = r.metadata?.importedAs
    if (typeof as === "string" && as) relBindings.set(String(r.target), as)
  }
  for (const [target, want] of [["models:ProductVariant", "PV"], ["models:*", "models_alias"]] as const) {
    if (relBindings.get(target) !== want) {
      fail("A-analyzer-carries", `imports ${target} carries importedAs=${JSON.stringify(relBindings.get(target) ?? null)} (want ${JSON.stringify(want)})`)
    }
  }
  // ROUND 17: the ROW the store consumes must carry it too. The EDGE above has carried
  // `metadata.importedAs` since round 7 and no store consumer reads it, so a gate that only looked
  // there would have stayed green through the entire period in which `brain_import.imported_as`
  // had no writer on this path. This is the near-side half of check B.
  const rowsForItem = (app.imports ?? []).filter(
    (i: any) => i.module === "models" && Array.isArray(i.items) && i.items.includes("ProductVariant"),
  )
  // Two finders on purpose: the row set contains the PLAIN `from models import ProductVariant` too,
  // so addressing the aliased row by `items` alone would read whichever came first and report the
  // wrong field. The binding is what distinguishes it, and the item list is asserted on ITS OWN row.
  const pvRow = rowsForItem.find((i: any) => Array.isArray(i.itemBindings))
  const pvBinding = (pvRow?.itemBindings ?? []).find((b: any) => b?.name === "ProductVariant")
  if (!rowsForItem.some((i: any) => i.items.includes("ProductVariant"))) {
    fail("A-analyzer-carries", "no `models` row lists the item ProductVariant at all — the item list itself is not published")
  }
  if (!pvRow) {
    fail("A-analyzer-carries", "the `from models import ProductVariant as PV` ROW publishes no itemBindings — the store's `imported_as` has no source to read (PY-D13's store half)")
  } else {
    if (!pvBinding) {
      fail("A-analyzer-carries", `the row's itemBindings is ${JSON.stringify(pvRow.itemBindings)} — no entry names the item ProductVariant`)
    } else if (pvBinding.as !== "PV") {
      fail("A-analyzer-carries", `the row's itemBindings entry for ProductVariant is ${JSON.stringify(pvBinding.as)} (want "PV")`)
    }
    if (pvRow.items.join(",") !== "ProductVariant") {
      fail("A-analyzer-carries", `the aliased row's \`items\` is ${JSON.stringify(pvRow.items)} — the binding must NOT move into the item list, which is what the \`module:item\` edge target and the verdict's counts spell`)
    }
  }
  console.log(`  A  analyzer carries: ImportInfo.alias="t" for \`import typing as t\`;`)
  console.log(`     relation bindings ${JSON.stringify([...relBindings.entries()])}`)

  // ---- B/C/D. what the STORE holds, through the REAL pipeline -----------------
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

  // ---- B. the store's import rows -------------------------------------------
  const importRows = db
    .prepare(`SELECT imported_name, imported_as, import_path, import_type FROM brain_import WHERE project_id = ?`)
    .all(pid) as any[]
  const show = (): string => importRows
    .map((r) => `${r.imported_name}${r.imported_as ? ` as ${r.imported_as}` : ""} (${r.import_type}) from ${r.import_path ?? "?"}`)
    .join(" | ")
  const typingRow = importRows.find((r) => String(r.import_path ?? "").includes("typing"))
  // ROUND 17 — the gap these assertions used to PIN is closed, so they now assert the VALUE. Written
  // in both directions on purpose: a column with exactly one writer on this path can be wrong by
  // carrying too little (the shapes below) or too much (the `os` control).
  if (!typingRow) {
    fail("B-store-carries", "no brain_import row for the `import typing as t` specifier at all")
  } else {
    if (typingRow.imported_as !== "t") {
      fail("B-store-carries", `brain_import.imported_as for \`import typing as t\` is ${JSON.stringify(typingRow.imported_as)} (want "t") — the AST path's bound-name writer is gone or the projection stopped emitting \`alias\``)
    }
    // STILL DECLARED, and pinned so it cannot drift unseen: the classification. The projection does
    // not pass the analyzer's `importType` to the field the indexer reads, and `brain.sql.ts`'s
    // vocabulary makes routing it a contract decision rather than a plumbing one (see the header).
    if (typingRow.import_type !== "named") {
      fail("B-store-classification(FLIPPED)", `brain_import.import_type for typing is now ${JSON.stringify(typingRow.import_type)} — the classification half of PY-D13 moved; update this pin, the projection's own comment and PY-D13`)
    }
  }
  // THE FROM-IMPORT SHAPES — the ones the projection dropped for every language, and the shapes the
  // per-item publication exists for. `PV` is the aliased FIRST item; `v` is a namespace import the
  // store could not name before round 17.
  const fromAliasRow = importRows.find((r) => r.imported_as === "PV")
  if (!fromAliasRow) {
    fail("B-store-carries", "no brain_import row with imported_as=\"PV\" — `from models import ProductVariant as PV` reached the store without its bound name (PY-D13's store half, still open)")
  } else if (fromAliasRow.imported_name !== "ProductVariant") {
    fail("B-store-carries", `the aliased row's imported_name is ${JSON.stringify(fromAliasRow.imported_name)} (want "ProductVariant") — the binding must ride alongside the IMPORTED name, not replace it`)
  }
  if (!importRows.some((r) => r.imported_as === "v")) {
    fail("B-store-carries", "no brain_import row with imported_as=\"v\" — `import vendor as v` (the route D pins) reached the store without its bound name")
  }
  // THE OVER-CLAIM DIRECTION. `patterns.ts` computes `usedName = imported_as || imported_name`, so a
  // binding invented for a plain import would make an unused import look used — the mirror of the
  // defect this column had. `import os` binds `os`, which is already the imported name.
  const plainRow = importRows.find((r) => String(r.import_path ?? "") === "os")
  if (plainRow && plainRow.imported_as !== null) {
    fail("B-store-carries", `brain_import.imported_as for the plain \`import os\` is ${JSON.stringify(plainRow.imported_as)} — a binding that merely repeats the imported name is noise, not a fact`)
  }
  if (typingRow && fromAliasRow) {
    note.push(`B: brain_import carries the bound name on the AST path — imported_as="t" for \`import typing as t\`, "PV" for the from-import's aliased item, "v" for the namespace import, NULL for the plain \`import os\`. PY-D13's STORE HALF IS CLOSED; its CLASSIFICATION half is not, and \`import_type\` stays "named" (pinned above).`)
  }
  console.log(`  B  store holds ${importRows.length} import row(s): ${show()}`)

  // ---- E. the WORKER PROJECTION splits the two roles of `X as Y` ---------------
  // The projection is the indexer's INPUT, so a defect here is invisible to every check that only
  // looks at the analyzer or only at the store — it shows up as a wrong VALUE in B. This check
  // names the two fields and their two meanings (`name` = what the source module declares,
  // `alias` = what this file binds), so a producer that conflates them again fails HERE rather than
  // silently making `imported_name` and `imported_as` the same string.
  const { parseFile } = (await import(path.join(ROOT, "src/ast/pool-worker.ts"))) as any
  const tsRes = await parseFile(path.join(srcDir, "main.ts"), project)
  const tsAliased = (tsRes.imports ?? []).find((i: any) => String(i.path ?? "").includes("a"))
  if (!tsAliased) {
    fail("E-projection-roles", "the worker projection returned no import for `import { A as B } from \"./a\"`")
  } else {
    if (tsAliased.name !== "A") {
      fail("E-projection-roles", `the projection's \`name\` for \`import { A as B } from "./a"\` is ${JSON.stringify(tsAliased.name)} (want "A", the IMPORTED name) — the two roles are conflated again`)
    }
    if (tsAliased.alias !== "B") {
      fail("E-projection-roles", `the projection's \`alias\` is ${JSON.stringify(tsAliased.alias ?? null)} (want "B", the bound name)`)
    }
  }
  console.log(`  E  projection  import { A as B } -> name=${JSON.stringify(tsAliased?.name ?? null)} alias=${JSON.stringify(tsAliased?.alias ?? null)}  (want "A" / "B")`)
  // …and the value those two fields produce in the store, which is what B's third row asserts.
  const tsStoreRow = importRows.find((r) => String(r.import_path ?? "").includes("a"))
  if (!tsStoreRow) {
    fail("E-projection-roles", "the typescript import reached no brain_import row at all, so the two roles cannot be read from the store")
  } else if (tsStoreRow.imported_name !== "A" || tsStoreRow.imported_as !== "B") {
    fail("E-projection-roles", `the typescript aliased import is stored as ${JSON.stringify({ name: tsStoreRow.imported_name, as: tsStoreRow.imported_as })} (want "A"/"B") — with the two roles conflated the row cannot say what was imported`)
  } else {
    note.push(`E: the projection's two roles survive to the store — typescript's \`import { A as B } from "./a"\` is stored as imported_name="A", imported_as="B". Both fields held "B" before round 17, so the row could not say what was imported, and \`patterns.ts\` would have been right by accident on that shape alone.`)
  }

  // ---- F. the ROW MODEL: every item of a statement is a ROW, not just the last --------
  // The projection hands the indexer one row per ITEM; the store's id used to be one row per
  // STATEMENT (`${fileId}:import:${moduleName}:${line}`, both fields shared by every item of the
  // statement) and the insert is `INSERT OR REPLACE`, so each item overwrote the previous one and a
  // file's import surface could not be read as a set. The two statements below are built so this
  // check cannot pass on a coincidence: the aliased item is FIRST in one and LAST in the other, and
  // a check that only looked for the alias would pass on the second one alone while the first one's
  // binding was being destroyed. The count is asserted too, because "every item" is a statement
  // about the SET and not only about the four names this fixture happens to list.
  const modelsRows = importRows.filter((r) => String(r.import_path ?? "") === "models")
  const wantItems: Array<[string, string | null]> = [
    ["marker_one", "m1"],
    ["marker_two", null],
    ["marker_three", null],
    ["marker_four", "m4"],
  ]
  for (const [name, as] of wantItems) {
    const row = modelsRows.find((r) => r.imported_name === name)
    if (!row) {
      fail(
        "F-row-model",
        `the store has NO row for the item ${JSON.stringify(name)} of a multi-item statement — the row id is per STATEMENT again (\`module:line\`, INSERT OR REPLACE), so all but the LAST item of every statement are overwritten. models rows present: ${JSON.stringify(modelsRows.map((r: any) => `${r.imported_name}${r.imported_as ? ` as ${r.imported_as}` : ""}`))}`,
      )
    } else if ((row.imported_as ?? null) !== as) {
      fail(
        "F-row-model",
        `the row for the item ${JSON.stringify(name)} carries imported_as=${JSON.stringify(row.imported_as ?? null)} (want ${JSON.stringify(as)}) — the item survived but its BINDING did not, which is the aliased-item-in-first-position direction`,
      )
    }
  }
  // The count is a SET statement, so it names every row it expects rather than only a number —
  // including `models as models_alias`, which is a row for the SAME specifier coming from
  // `import models as models_alias` (a namespace statement whose row id was never at risk, and which
  // therefore also proves the per-item id did not merge two DIFFERENT statements together).
  const modelsExpectedNames = [
    "ProductVariant",
    "ProductVariant as PV",
    "Sku",
    "models as models_alias",
    "marker_one as m1",
    "marker_two",
    "marker_three",
    "marker_four as m4",
  ]
  const seenModels = modelsRows.map((r: any) => `${r.imported_name}${r.imported_as ? ` as ${r.imported_as}` : ""}`)
  if (modelsRows.length !== modelsExpectedNames.length) {
    fail(
      "F-row-model",
      `${modelsRows.length} row(s) for the \`models\` specifier (want ${modelsExpectedNames.length}: ${modelsExpectedNames.join(", ")}). The store's import surface is a SET now: one row per item, and a count that is low means items are being replaced rather than added. Present: ${JSON.stringify(seenModels)}`,
    )
  }
  for (const want of modelsExpectedNames) {
    if (!seenModels.includes(want)) {
      fail("F-row-model", `the \`models\` rows do not contain ${JSON.stringify(want)} (present: ${JSON.stringify(seenModels)})`)
    }
  }
  console.log(`  F  ROW MODEL  ${modelsRows.length} \`models\` row(s): ${seenModels.join(" | ")}  (want ${modelsExpectedNames.length})`)
  if (problems.every((p) => p.id !== "F-row-model")) {
    note.push(`F: the store keeps EVERY item of a multi-item statement — \`marker_one as m1, marker_two\` (aliased item FIRST) and \`marker_three, marker_four as m4\` (aliased item LAST) are four rows, and the \`models\` specifier has ${modelsRows.length} rows in total, including the \`import models as models_alias\` row that shares the specifier without sharing the statement. Before round 18 the id was per statement and 3,000 of 11,903 projected rows on a 2,000-file sample were replaced before anyone could read them.`)
  }

  // ---- G. the two item classes that never reached a row ------------------------
  // G1 — `from __future__ import annotations`: tree-sitter-python gives this construct a node type
  // of its own and the grammar does NOT expose the module as a named child, so a walk that
  // dispatches on `import_statement | import_from_statement` never saw it and the file's own
  // `__future__` dependency reached no row and no edge (1,286 statements / 1,298 items over the
  // python population).
  const futureRow = importRows.find((r) => String(r.import_path ?? "") === "__future__" && r.imported_name === "annotations")
  if (!futureRow) {
    fail(
      "G-future-import",
      `no brain_import row for \`from __future__ import annotations\` — the \`future_import_statement\` node type is not dispatched again, so the file's own future dependency is invisible (rows present: ${JSON.stringify(importRows.map((r: any) => `${r.imported_name}<-${r.import_path}`))})`,
    )
  }
  // G2 — `from clock import clock`: the module and the item are the same word, and the item loop
  // skipped the module BY TEXT, so the item was thrown away. On this shape the ROW exists either
  // way (the projection falls back to the module when the item list is empty) which is exactly why
  // the EDGE is the discriminating channel and why the fixture declares a real `clock` module.
  const clockRow = importRows.find((r) => String(r.import_path ?? "") === "clock" && r.imported_name === "clock")
  // THE EDGE IS READ IN BOTH SHAPES IT CAN TAKE, and that is not laxity: `clock.py` EXISTS in this
  // fixture project (it has to, or the module-named item would be a statement about a module the
  // index cannot see), so the store's resolution pass legitimately binds `clock:clock` to the
  // symbol `clock` that file declares — the external spelling is what the ANALYZER emits and the
  // resolved one is what the STORE keeps. What the check discriminates is the difference between an
  // edge (either shape) and NO edge, which is the pre-round-18 state on this shape: an item skipped
  // as if it were the module node is never emitted, so nothing exists to resolve.
  const importEdges = db
    .prepare(
      `SELECT r.relationship_type AS t, s.name AS src, r.target_external AS tgtExt,
              tg.name AS tgtName, f.path AS tgtFile
         FROM brain_relationship r
         LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
         LEFT JOIN brain_symbol tg ON tg.id = r.target_symbol_id
         LEFT JOIN brain_file f ON f.id = tg.file_id
        WHERE r.project_id = ? AND r.relationship_type = 'imports'`,
    )
    .all(pid) as any[]
  const clockEdge = importEdges.find(
    (e: any) =>
      String(e.tgtExt ?? "") === "clock:clock" ||
      (String(e.tgtName ?? "") === "clock" && String(e.tgtFile ?? "").endsWith("clock.py")),
  )
  if (!clockRow) {
    fail("G-module-named-item", "no brain_import row with imported_name=\"clock\" from specifier \"clock\"")
  }
  if (!clockEdge) {
    fail(
      "G-module-named-item",
      `no \`imports\` edge for \`from clock import clock\` — in either shape the store can hold (target_external \`clock:clock\`, or that specifier resolved to the \`clock\` symbol this project declares). The item was skipped as if it were the module node again, so the item loop is comparing TEXT rather than node identity. imports edges present: ${JSON.stringify(importEdges.map((e: any) => e.tgtExt ?? e.tgtName))}`,
    )
  }
  console.log(`  G  ITEM CLASSES  __future__ row=${futureRow ? "PRESENT" : "MISSING"}  clock edge=${clockEdge ? "PRESENT" : "MISSING"}`)
  if (futureRow && clockRow && clockEdge) {
    note.push(`G: the two classes that used to vanish reach both channels — \`from __future__ import annotations\` reaches a row (module \`__future__\`, which the grammar does not expose as a named child), and \`from clock import clock\` reaches its \`clock:clock\` edge, which is the shape a text-based module skip cannot keep. Neither binds a symbol: \`annotations\` is a compiler directive and \`clock\` is a module handle.`)
  }

  // ---- C. CONTROL: an in-population bare base DOES resolve --------------------
  const edges = db
    .prepare(
      `SELECT r.relationship_type AS t, s.name AS src,
              COALESCE(tg.name, r.target_external) AS tgt,
              r.target_symbol_id AS tid
         FROM brain_relationship r
         LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id
         LEFT JOIN brain_symbol tg ON tg.id = r.target_symbol_id
        WHERE r.project_id = ? AND r.relationship_type IN ('extends','references')`,
    )
    .all(pid) as any[]
  const find = (t: string, src: string, tgt: string): any =>
    edges.find((e: any) => e.t === t && String(e.src ?? "").endsWith(src) && String(e.tgt ?? "").endsWith(tgt))
  const control = find("extends", "Plain", "Sku")
  if (!control) {
    fail("C-control", "no `extends Plain -> Sku` row in the store — the harness cannot see the shape it is testing")
  } else if (!control.tid) {
    fail("C-control", "`extends Plain -> Sku` is UNRESOLVED — this row must resolve (the project declares Sku once), so B/D's NULLs cannot be read as a seam finding until this control is green")
  }
  console.log(`  C  CONTROL  extends Plain -> Sku  ${control && control.tid ? "RESOLVED" : "UNRESOLVED"}  (must be RESOLVED)`)

  // ---- D. the ROUTE: two references, two DIFFERENT routes, one answer ---------
  // THE FIRST TWO PINS HERE WERE WRONG, AND THAT IS WHY THIS ONE IS SHAPED THIS WAY.
  // Pin 1 pointed the route at the only class the project declared: the leaf was unique, the
  // store's leaf fallback bound it, and the row read RESOLVED — which said nothing about routes.
  // Pin 2 declared the leaf TWICE, expecting ambiguity to force a decline. Also wrong: the pass's
  // strategy 3c RANKS dotted candidates (definition first, own file, own language, lowest id) and
  // takes the best (`parallel-indexer.ts`, "the SAME ranking the eager resolve used"), so an
  // ambiguous leaf still resolves — silently, to whichever candidate the ranking prefers.
  //
  // A pin can only discriminate if the two readings differ. So the project now carries TWO
  // references to the SAME leaf through DIFFERENT routes: `models_alias.ProductVariant` and
  // `v.ProductVariant`, where the aliases bind different modules that each declare the name.
  // If anything outside the analyzers read the route, these two edges would resolve to DIFFERENT
  // symbols BY CONSTRUCTION. They do not. That equality is the proof, and it is the flip signal:
  // the moment a route consumer lands, this row turns red and names it.
  const leafCandidates = db
    .prepare(`SELECT COUNT(*) AS n FROM brain_symbol WHERE project_id = ? AND name = 'ProductVariant'`)
    .get(pid) as any
  if (!leafCandidates || Number(leafCandidates.n) < 2) {
    fail("D-route", `only ${leafCandidates?.n ?? 0} symbol(s) named ProductVariant — the collision that makes this row able to discriminate is missing`)
  }
  const viaModels = find("references", "via_models", "ProductVariant")
  const viaVendor = find("references", "via_vendor", "ProductVariant")
  if (!viaModels || !viaVendor) {
    fail("D-route", `the routed references are not both in the store (via_models=${!!viaModels}, via_vendor=${!!viaVendor})`)
  } else {
    const targetOf = (e: any): string =>
      (db.prepare(`SELECT COALESCE(f.path, s.qualified_name) AS where_ FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE s.id = ?`).get(e.tid ?? "") as any)?.where_ ?? "(unresolved)"
    const whereA = viaModels.tid ? targetOf(viaModels) : "(unresolved)"
    const whereB = viaVendor.tid ? targetOf(viaVendor) : "(unresolved)"
    if (!viaModels.tid || !viaVendor.tid) {
      fail("D-route(FLIPPED)", `a routed reference is now UNRESOLVED (via_models=${viaModels.tid ? "resolved" : "UNRESOLVED"}, via_vendor=${viaVendor.tid ? "resolved" : "UNRESOLVED"}) — the store stopped ranking dotted targets; update PY-D13/PY-D14 and this pin`)
    } else if (String(viaModels.tid) !== String(viaVendor.tid)) {
      fail("D-route(FLIPPED)", `the two DIFFERENT routes now resolve to DIFFERENT symbols (${whereA} vs ${whereB}) — a route consumer landed in the store; update PY-D13/PY-D14 and this pin`)
    } else {
      note.push(`D: \`models_alias.ProductVariant\` and \`v.ProductVariant\` — two different routes — resolve to the SAME symbol (${whereA}), which is the measured proof that the route is not read. Both resolve at all only because pass strategy 3c RANKS dotted candidates; the resolution is by ranking, not by route. The shared target is arbitrary between ${leafCandidates?.n ?? 0} same-named symbols.`)
    }
    console.log(`  D  ROUTE    via_models -> ${whereA}`)
    console.log(`  D  ROUTE    via_vendor -> ${whereB}   (declared: SAME symbol, so the route is unread)`)
  }

  console.log()
  for (const n of note) console.log(`  note  ${n}`)

  if (problems.length > 0) {
    console.log(`\nFAIL — ${problems.length} seam problem(s):`)
    for (const p of problems) console.log(`   ${p.id}: ${p.detail}`)
    process.exitCode = 1
    return
  }
  console.log(`\nPASS — A the analyzer carries every binding (the relation's metadata.importedAs AND the row's itemBindings); B the STORE carries it too (imported_as t/PV/v, NULL for the plain import), so PY-D13's store half is closed with the classification half still declared and pinned; C the CONTROL resolves, so B/D are seam findings and not a broken harness; D two DIFFERENT routes to the same leaf land on the SAME symbol, which is the measured proof the route is not read (and a route consumer would split them); E the projection keeps the two roles of \`X as Y\` apart; F the store keeps EVERY item of a multi-item statement (the row id is per item, not per statement); G the \`__future__\` statement and the module-named item reach a row and an edge`) 
}

main().catch((e) => { console.error(e); process.exit(1) })
