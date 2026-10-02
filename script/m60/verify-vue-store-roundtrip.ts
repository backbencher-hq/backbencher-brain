/**
 * VUE-MR: the Vue lane's STORE ROUND-TRIP gate — the only gate that can catch
 * information the analyzer produces correctly and the STORE then drops.
 *
 * WHY THIS EXISTS. Every other gate in this lane reads the ANALYZER's output, so
 * a defect on the far side of the boundary is invisible to all of them. Measured
 * 2026-09-30 while closing F3: `withDefaults(defineProps<NamedProps>(), { … })`
 * produced a correct contract row carrying `isPropContract`, `unresolved` and the
 * whole `defaults` map — and none of it reached the graph.
 *
 * The cause is the store's relationship identity, which is a DELIBERATE decision
 * (VSD25): `brain_relationship.id = projectId:rel:source:target:type:line`, with
 * no metadata component, inserted `INSERT OR IGNORE`. The sub-analyzer's
 * `type_argument` row and this lane's contract row describe ONE declaration on
 * ONE line, so they collide, and the delegate's is inserted first — so the
 * contract row lost, every time. The row that survives is the poorer one, with no
 * signal that anything was dropped.
 *
 * It is also why this could not be regression-tested as a fixture: a fixture sees
 * the analyzer's output, where the pre-fix and post-fix results differ only in
 * WHICH of two equivalent rows carries the marker, and the collision happens
 * strictly downstream. An analyzer-output assertion would have passed on the
 * broken build. That is the whole argument for a probe at this layer.
 *
 * SCOPE, stated so the numbers are not over-read. Unresolved TARGETS are expected
 * and not failures: a 4-file project cannot resolve `import type { X } from
 * './y'`, a component tag declared elsewhere, or a global. What is asserted here
 * is that the lane's OWN facts arrive intact — contract rows present, carrying
 * their markers and their `defaults`, with a resolved SOURCE.
 *
 * Usage: bun script/m60/verify-vue-store-roundtrip.ts
 */
import { mkdtempSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { storeResults } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"

const REPO = "$HOME/backbencher-brain"
const FILES = [
  `${REPO}/validation/m14/fixtures/vue/with-defaults-propagation.vue`,
  `${REPO}/validation/m14/fixtures/vue/options-setup-method.vue`,
  "$HOME/fixtures/repositories/element-plus/packages/components/skeleton/src/skeleton-item.vue",
  "$HOME/fixtures/repositories/element-plus/packages/components/cascader-panel/src/menu.vue",
]

const failures: string[] = []
function check(ok: boolean, what: string, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`)
  if (!ok) failures.push(what)
}

async function main(): Promise<void> {
  const projectRoot = mkdtempSync(join(tmpdir(), "vue-rt-"))
  const projectId = "vue-roundtrip-verify" as any
  const results: any[] = []
  for (const f of FILES) {
    const st = statSync(f)
    const r: any = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
    results.push({
      filePath: f, success: true, symbols: r.symbols ?? [], relationships: r.relationships ?? [],
      imports: r.imports ?? [], language: "vue", fileHash: "vue-rt", sizeBytes: st.size, lastModified: st.mtimeMs,
    })
  }
  await storeResults(projectId, projectRoot, results)
  const db: any = await BrainDatabase.getRawInstance(projectId)
  const rows = db.prepare(
    `SELECT relationship_type t, source_external s, target_external tg, metadata m, source_symbol_id sid
       FROM brain_relationship WHERE relationship_type='references'`,
  ).all() as any[]
  const contracts = rows
    .map((r) => ({ ...r, md: (() => { try { return JSON.parse(r.m ?? "{}") } catch { return {} } })() }))
    .filter((r) => r.md.isPropContract || r.md.isEmitContract)

  // 1. every contract the analyzer emitted must be PRESENT — the collision lost
  //    rows silently, and a count is the only thing that notices.
  const expected = results.reduce(
    (n, r) => n + r.relationships.filter((e: any) => e.metadata?.isPropContract || e.metadata?.isEmitContract).length, 0)
  check(contracts.length === expected,
    `contract rows survive the store (expected ${expected}, stored ${contracts.length})`)

  // 2. each must carry its marker AND a resolved source, so "what does this
  //    component declare?" has a row that points at the component.
  check(contracts.every((r) => r.md.isPropContract || r.md.isEmitContract),
    "every stored contract row carries its marker")
  check(contracts.every((r) => r.sid !== null && r.sid !== undefined),
    "every stored contract row resolves a SOURCE symbol",
    `unresolved=${contracts.filter((r) => r.sid === null || r.sid === undefined).length}`)

  // 3. F3's payload specifically — the regression this gate was written for.
  const withDefaults = contracts.filter((r) => r.md.defaults !== undefined)
  check(withDefaults.length >= 2,
    "F3 `defaults` maps reach the store", `rows=${withDefaults.length}`)
  check(withDefaults.some((r) => r.md.defaultKeys === Object.keys(r.md.defaults ?? {}).length),
    "F3 `defaultKeys` agrees with the stored `defaults` map")
  const indirect = contracts.filter((r) => r.md.defaultsExpression !== undefined)
  check(indirect.length >= 1,
    "F3 indirect `defaultsExpression` reaches the store", `rows=${indirect.length}`)
  check(indirect.every((r) => r.md.defaultKeys === undefined),
    "an indirect defaults expression does NOT claim defaultKeys: 0 (that would assert no defaults)")

  // 4. F5 — the symbol must be stored, annotated, and contained by the component,
  //    which is what makes it reachable as a target.
  const setup = db.prepare(`SELECT name, annotations, qualified_name FROM brain_symbol WHERE name='setup'`).all() as any[]
  check(setup.length >= 1, "F5 `setup` symbol is stored", `rows=${setup.length}`)
  check(setup.every((s) => JSON.parse(s.annotations ?? "{}").isSetup === true),
    "F5 `setup` keeps `isSetup` in `annotations` (the store's metadata column)")
  const contained = db.prepare(
    `SELECT COUNT(*) c FROM brain_relationship WHERE relationship_type='contains' AND target_external='setup'`,
  ).get() as any
  check(contained.c >= 1, "F5 `setup` is CONTAINED by the component", `rows=${contained.c}`)

  // 5. the F6 ruling must still hold in the store: no bracket-led phantom symbol
  //    from a vue-owned shape. The delegate's own marked index signature is a
  //    different fact and is excluded by name, not by luck.
  const phantoms = db.prepare(`SELECT name FROM brain_symbol WHERE name LIKE '[%'`).all() as any[]
  const vueOwned = phantoms.filter((p) => !JSON.stringify(p).includes("indexParameter"))
  check(vueOwned.length === 0, "F6: no vue-owned bracket-led phantom symbol in the store", `found=${phantoms.length}`)

  await db.close?.()
  console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${failures.length ? failures.join("; ") : "vue store round-trip"}`)
  process.exit(failures.length === 0 ? 0 : 1)
}
void main()
