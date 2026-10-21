/**
 * DART — A `typedef` IS A DECLARATION, AND THE INDEX HAS TO KNOW IT.
 *
 * WHAT THIS PROVES, and what it cost.
 *
 * THE DEFECT. Dart's SDK declares two of its most-used mixins as ALIASES:
 *   sdk/lib/collection/list.dart:586  `typedef ListMixin<E> = ListBase<E>;`
 *   sdk/lib/collection/set.dart:322   `typedef SetMixin<E> = SetBase<E>;`
 * A class that applies one of them (`class _BoolArrayList with ListMixin<bool>`) asks the
 * project index whether the base declares the member it overrides. The dart spec's `typeNodes`
 * had no `type_alias` entry, so the index held NOTHING for the alias: the question came back
 * "no such base", the analyzer's first-parent fallback published "this base is OUTSIDE the
 * project" (`isExternalBase: true`, confidence 0.8), and the arbiter REFUTED that claim — because
 * the project DOES publish the name, as an alias. The arbiter was right and the row was wrong.
 *
 * MEASURED ON THE PRODUCTION ARM (`.tmp-lane/dart-prod-index-FIXED.json`, the `overrides` row):
 * 25 refuted rows over 11 distinct targets, every one of them a `ListMixin.*` or `SetMixin.*`
 * member. The arm's own `refutedNames` list carries them with `namesOmitted.refuted: 0`, so that
 * list is the WHOLE set, not a sample.
 *
 * THE FIX, in the dart spec block of `src/ast/project-index.ts`: `type_alias: "typedef"` in
 * `typeNodes`, the alias NAME in `nameResolver` (the first direct `type_identifier` child), and
 * the alias TARGET in `baseResolver` (the last direct `type_identifier` child). The target is
 * recorded as the alias's base because an alias HAS its target's members, and the index's
 * inheritance closure is what carries them to the alias.
 *
 * THE GRAMMAR, PROBED AND NOT REMEMBERED (`bun run script/m14/dart-typedef-alias-probe.ts`):
 *   typedef ListMixin<E> = ListBase<E>;
 *   → (type_alias (type_identifier) (type_parameters (type_parameter (type_identifier)))
 *                (type_identifier) (type_arguments (type_identifier)))
 * The FIRST direct `type_identifier` is the alias name, the LAST is the target, and the target's
 * own `type_arguments` hold further `type_identifier`s — but they are NESTED, so the direct-child
 * rule is enough. A `type_alias` has no `name` field, which is why the generic resolver reads "".
 *
 * THIS PROBE RUNS BOTH SPECS ON THE SAME THREE-FILE PROJECT AND REQUIRES THE DIFFERENCE:
 * the pre-fix spec must publish the external-base claim, and the fixed spec must not. A probe
 * that only ran the fixed spec would pass on a fix that changes nothing.
 */
import * as path from "node:path"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { buildProjectIndexFromDisk } from "../../src/ast/project-index"
import { DART_DECLARATION_SPEC } from "../../src/ast/project-index"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(process.cwd())
const WORK = path.join(ROOT, ".tmp-lane", "dart-typedef-alias-probe")

/** THE THREE-FILE REPRODUCTION. The alias and its target are in SEPARATE files on purpose: the
 *  question the index is asked ("does the base declare the member?") is a CROSS-FILE question,
 *  and a single-file case would not exercise it. */
const FILES: Record<string, string> = {
  "base.dart": `class Base {\n  int get length => 0;\n}\n`,
  "alias.dart": `typedef MyMixin = Base;\n`,
  "use.dart": `class Holder with MyMixin {\n  @override\n  int get length => 1;\n}\n`,
}

/** THE SPEC WITHOUT THE FIX — the dart spec as it was before the alias entry. Built by REMOVING
 *  the one entry, so the control cannot drift from the fix. */
const PRE_FIX_SPEC: any = {
  ...DART_DECLARATION_SPEC,
  typeNodes: { ...DART_DECLARATION_SPEC.typeNodes },
}
delete PRE_FIX_SPEC.typeNodes.type_alias

async function run(spec: any, label: string): Promise<{ external: boolean; conf: number; kinds: string[]; bases: string[] }> {
  const index = await buildProjectIndexFromDisk(path.join(ROOT, "wasm", "tree-sitter-dart.wasm"), Object.keys(FILES).map((f) => path.join(WORK, f)), spec)
  const r: any = await parseFile(path.join(WORK, "use.dart"), WORK, { projectIndex: index, projectRoot: WORK } as any)
  const rows = (r?.relationships ?? []).filter((e: any) => String(e.type) === "overrides")
  const row = rows[0]
  return {
    external: (row?.metadata as any)?.isExternalBase === true,
    conf: Number(row?.confidence ?? 0),
    kinds: [...index.typeKinds.entries()].map(([k, v]) => `${k}=${v}`),
    bases: [...index.typeBases.entries()].map(([k, v]) => `${k}->${[...v].join(",")}`),
  }
}

let failures = 0
const fail = (m: string): void => { failures++; console.error(`FAIL ${m}`) }
const ok = (m: string): void => console.log(`  ok  ${m}`)

mkdirSync(WORK, { recursive: true })
for (const [name, body] of Object.entries(FILES)) writeFileSync(path.join(WORK, name), body)

console.log("=== THE PRE-FIX SPEC (the control: the index holds NOTHING for the alias)")
const before = await run(PRE_FIX_SPEC, "pre-fix")
console.log(`  index: typeKinds ${JSON.stringify(before.kinds)} · typeBases ${JSON.stringify(before.bases)}`)
if (!before.kinds.some((k) => k.startsWith("MyMixin="))) ok("the pre-fix index holds NO entry for the alias — the measured pre-fix state")
else fail(`the pre-fix index holds ${before.kinds.find((k) => k.startsWith("MyMixin="))} — the control is not the pre-fix state`)
if (before.external) ok(`the pre-fix spec publishes the EXTERNAL-BASE claim (confidence ${before.conf}) — the defect, reproduced`)
else fail("the pre-fix spec did not publish the external-base claim — the defect is not reproduced, so this probe would not detect its own fix")

console.log("\n=== THE FIXED SPEC (the alias is a declaration, and its target is its base)")
const after = await run(DART_DECLARATION_SPEC, "fixed")
console.log(`  index: typeKinds ${JSON.stringify(after.kinds)} · typeBases ${JSON.stringify(after.bases)}`)
if (after.kinds.includes("MyMixin=typedef")) ok("the fixed index records the alias as a DECLARATION (kind typedef)")
else fail(`the fixed index records ${after.kinds.find((k) => k.startsWith("MyMixin=")) ?? "no entry"} for the alias`)
if (after.bases.includes("MyMixin->Base")) ok("the fixed index records the alias TARGET as the alias's base — the closure carries the target's members to the alias")
else fail(`the fixed index's bases are ${JSON.stringify(after.bases)} — the alias does not reach its target`)
if (!after.external) ok(`the fixed spec publishes NO external-base claim (confidence ${after.conf}) — the override is verified against the index`)
else fail("the fixed spec STILL publishes the external-base claim — the fix does not close the defect")

console.log(failures === 0 ? "\nPASS" : `\nFAIL — ${failures} control(s) failed`)
if (failures === 0) rmSync(WORK, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 3)
