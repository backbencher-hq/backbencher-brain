/**
 * INVARIANT-GUARD PROOF — can the export invariant still FAIL after the role widening?
 *
 * ## What changed, and what this file has to show
 *
 * `script/m14/run-fixtures.ts`'s export invariant used to admit a non-symbol export name only
 * through `isJsFamily` (a language list). The exports/contains ruling
 * (`docs/analyzers/EXPORTS-CONTAINS-RULING.md`) replaces that with the ROLE its own comment
 * already described — "live module properties importable by name without a corresponding
 * symbol" — declared by the LANE on its export entries (`viaCommonJs`, `luaSpecific`).
 *
 * A widened guard is worth nothing unless it can still fail, and this programme has already
 * paid for that lesson: three dart FORBID rows were inert after a separator move, and a
 * probe that cannot fire returns the same number as a clean one. So this file plants four
 * cases through the runner's OWN `runLang` (imported, never reimplemented — the assertion has
 * to be about the shared invariant, not a copy of it) and requires each to land where the
 * ruling says it must:
 *
 *   1. BASELINE lua            -> 0 failures (the two red fixtures closed by the ruling)
 *   2. lua + an export name no symbol carries, WITH the lane's own marker
 *                              -> STILL 0: the lane declares its surface to be module
 *                                 properties, so over-publication is the LANE's to police,
 *                                 not the invariant's. This is the residual the ruling names,
 *                                 and it is asserted here as a KNOWN consequence rather than
 *                                 left to be discovered.
 *   3. lua + the SAME name, marker REMOVED
 *                              -> MUST FAIL. The admission is the lane's declaration, not the
 *                                 file extension: strip the declaration and the name is refused
 *                                 again. Without this case, "we widened it" and "we disabled
 *                                 it" are the same observation.
 *   4. java + an export name taken from the file's OWN owned member symbols
 *                              -> MUST FAIL. The member clause ("bare member names are not
 *                                 importable; membership rides Contains") is what the M49
 *                                 invariant was written for; it has 0 live hits fleet-wide, so
 *                                 its only possible demonstration is a planted one.
 *
 * The planters call `Cls.setGrammar(parser.language, parser.constructor)` themselves, because
 * `runLang` performs that handoff only on its own analyzer path (run-fixtures.ts:529-561) and a
 * planted run without it could differ from the baseline for a reason that has nothing to do
 * with the plant — which would make the delta unreadable.
 *
 * Usage: npx tsx validation/m14/fixtures/exports-ruling/invariant-guard-proof.ts
 * Exit 0 iff every case lands where the ruling says it must.
 */
import { runLang } from "../../../../script/m14/run-fixtures"
import { getParser } from "../../../../src/ast/engine"

const cls = (mod: any): any => Object.values(mod).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name))

/** Wrap a lane's real analyzer so it also publishes `extra` export entries. */
async function planter(lang: string, modPath: string, extraFor: (result: any) => any[]): Promise<any> {
  const mod: any = await import(modPath)
  const Cls = cls(mod)
  const parser: any = await getParser(lang)
  try {
    const ctor: any = Cls
    if (typeof ctor?.setGrammar === "function") ctor.setGrammar(parser.language, parser.constructor)
  } catch { /* same contract as the runner: no grammar, main pass only */ }
  return {
    analyze: async (root: any, content: string, label: string, ctx?: any) => {
      const r: any = await new Cls().analyze(root, content, label, ctx)
      const extra = extraFor(r)
      if (extra.length === 0) return r
      return { ...r, exports: [...(r.exports ?? []), ...extra] }
    },
  }
}

const results: { case: string; baseline?: number; got: number; want: string; ok: boolean; note: string }[] = []
const record = (c: string, baseline: number | undefined, got: number, want: "zero" | "rise", note: string): void => {
  const ok = want === "zero" ? got === 0 : baseline !== undefined && got > baseline
  results.push({ case: c, baseline, got, want, ok, note })
}

// 1 — baseline
const luaBase = await runLang("lua")
record("lua baseline (the ruling's own outcome)", undefined, luaBase.fail, "zero",
  `pass ${luaBase.pass} fail ${luaBase.fail}`)

// 2 — a fabricated name WITH the lane's marker: admitted (documented residual)
const luaMarked = await runLang("lua", await planter("lua", "../../../../src/ast/real-lua-analyzer", () =>
  [{ name: "plantedNoSymbolWithMarker", isDefault: false, range: { startLine: 1, endLine: 1, startIndex: 0, endIndex: 1 }, metadata: { luaSpecific: true } }],
))
record("lua + fabricated name, lane marker PRESENT (documented residual: the lane polices its own surface)",
  luaBase.fail, luaMarked.fail, "zero", `pass ${luaMarked.pass} fail ${luaMarked.fail}`)

// 3 — the same name WITHOUT the marker: refused again
const luaUnmarked = await runLang("lua", await planter("lua", "../../../../src/ast/real-lua-analyzer", () =>
  [{ name: "plantedNoSymbolWithoutMarker", isDefault: false, range: { startLine: 1, endLine: 1, startIndex: 0, endIndex: 1 }, metadata: {} }],
))
record("lua + fabricated name, lane marker ABSENT (the admission is the lane's declaration, not the extension)",
  luaBase.fail, luaUnmarked.fail, "rise", `pass ${luaUnmarked.pass} fail ${luaUnmarked.fail}`)

// 4 — a member-named export in a lane that does NOT declare the module-value role
const javaBase = await runLang("java")
const javaMember = await runLang("java", await planter("java", "../../../../src/ast/real-java-analyzer", (r) => {
  const member = (r.symbols ?? []).find((s: any) => s?.ownerName && s?.name)
  if (!member) return []
  return [{ name: String(member.name), isDefault: false, range: { startLine: 1, endLine: 1, startIndex: 0, endIndex: 1 }, metadata: {} }]
}))
record("java + member-named export (the clause the M49 invariant was written for)",
  javaBase.fail, javaMember.fail, "rise", `baseline pass ${javaBase.pass} fail ${javaBase.fail} -> planted pass ${javaMember.pass} fail ${javaMember.fail}`)

// ------------------------------------------------------------------ report
console.log(`invariant-guard proof — the shared export invariant, planted through the runner's own runLang`)
console.log(``)
for (const r of results) {
  console.log(`${r.ok ? "OK  " : "MISS"}  ${r.case}`)
  console.log(`        want ${r.want === "zero" ? "0 failures" : `> baseline ${r.baseline}`}   got ${r.got}   (${r.note})`)
}
console.log(``)
const bad = results.filter((r) => !r.ok)
if (bad.length) {
  console.error(`${bad.length} case(s) did NOT land where the ruling says they must — the widened guard is not doing what the doc claims.`)
  process.exit(1)
}
console.log(`all ${results.length} cases land as ruled: the admission is the lane's declaration, the member clause still fires, and the residual is a stated consequence rather than an accident.`)
