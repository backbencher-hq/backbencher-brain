/**
 * DART — THE `Object`-INTERFACE RETARGET MUST ASK THE PROJECT, NOT ASSUME IT.
 *
 * THE DEFECT. When a class overrides a member that `Object` itself declares (`hashCode`,
 * `toString`, `operator ==`) and the class's FIRST HERITAGE PARENT does not declare it, the
 * analyzer retargets the override to `Object.<member>` and publishes `isExternalBase: true` —
 * the claim "the PROJECT does not publish this base". The arbiter checks exactly that against
 * the project's key space ✓.
 *
 * MEASURED ON THE PRODUCTION POPULATION (2026-10-21, the enumeration of the whole admitted set
 * with the alias fix in): **6 refuted rows, all in ONE file** —
 * `dart-sdk/third_party/pkg/language_server_protocol/lib/protocol_custom_generated.dart`:
 * `:1907 DartMigrateParams.hashCode -> Object.hashCode` · `:1916 …operator ==` ·
 * `:1946 …toString` · `:4297 LegacySnippetTextEdit.hashCode -> Object.hashCode` ·
 * `:4304 …operator ==` · `:4322 …toString` ✓✓.
 *
 * WHY: **the Dart SDK's own checkout PUBLISHES `Object`** — `sdk/lib/core/object.dart` declares
 * `class Object` ✓ — so in THAT project the claim is false, and the arbiter refuted it ✓. In the
 * other projects `Object` is not published, the claim is true, and the arbiter VERIFIED 301 such
 * rows ✓. **The same row shape, two answers, and the answer turns on a fact the project index
 * already holds ✓✓.**
 *
 * THE FIX, in `src/ast/real-dart-analyzer.ts`: the retarget consults the COMPANION (the project's
 * type inventory) before it publishes the external claim, and the test is the same one every other
 * pass uses — "does the base EXPOSE this member" ✓. A project that declares a name `Object`
 * WITHOUT those members (a benchmark's `t_Object__int`, a name COLLISION) does not buy the row an
 * exemption it has not earned ✓.
 *
 * THE CONTROL IS A PAIR OF PROJECTS, NOT A COUNT ✓✓ — because a fix that changes nothing and a fix
 * that over-corrects (always non-external) must BOTH fail this probe:
 *
 *   · project A DECLARES `class Object` with the interface members → the row must NOT be an
 *     external claim (the project publishes the base) ✓;
 *   · project B DOES NOT declare `Object` → the row MUST be an external claim (the project does
 *     not publish the base) ✓.
 *
 * The two projects differ in ONE file, and the outcomes must DIFFER ✓. A probe that only ran
 * project A would pass on a fix that removed the claim everywhere ✓✓.
 */
import * as path from "node:path"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { buildProjectIndexFromDisk, DART_DECLARATION_SPEC } from "../../src/ast/project-index"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(process.cwd())
const WORK = path.join(ROOT, ".tmp-lane", "dart-object-interface-probe")

/** THE CLASS UNDER TEST — `implements`-only, so its heritage names NO `Object` ✓, which is what
 *  makes the retarget the only path to `Object.<member>` ✓ (and what makes the row's first heritage
 *  parent a base that does NOT declare the member ✓). */
const USER = `class Holder implements Marker {\n  @override\n  int get hashCode => 1;\n\n  @override\n  bool operator ==(Object other) => true;\n\n  @override\n  String toString() => "h";\n}\n`
const MARKER = `abstract class Marker {}\n`
/** PROJECT A's `Object` — the dart:core shape ✓ (the members the retarget can name ✓). */
const OBJECT_DECL = `class Object {\n  int get hashCode => 0;\n  bool operator ==(Object other) => identical(this, other);\n  String toString() => "o";\n}\n`

async function run(withObject: boolean): Promise<{ rows: { member: string; target: string; external: boolean; conf: number }[] }> {
  const dir = path.join(WORK, withObject ? "project-a" : "project-b")
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "object.dart"), OBJECT_DECL)
  writeFileSync(path.join(dir, "marker.dart"), MARKER)
  writeFileSync(path.join(dir, "user.dart"), USER)
  // THE INDEX HOLDS `object.dart` AND NOTHING ELSE ✓✓ — because the base must be a name the index
  // does NOT know ✓, or the fallback is refuted and no row is published at all. That is the SDK's
  // own shape: `DartMigrateParams implements WorkDoneProgressParams` and the dart-sdk index holds
  // NO `WorkDoneProgressParams` (MEASURED in the cached index) ✓, so the fallback fired there ✓.
  // `marker.dart` is written so the file compiles, and it is DELIBERATELY NOT INDEXED ✓.
  const files = withObject ? [path.join(dir, "object.dart")] : []
  const index = await buildProjectIndexFromDisk(path.join(ROOT, "wasm", "tree-sitter-dart.wasm"), files, DART_DECLARATION_SPEC)
  const r: any = await parseFile(path.join(dir, "user.dart"), dir, { projectIndex: index, projectRoot: dir } as any)
  const rows = (r?.relationships ?? [])
    .filter((e: any) => String(e.type) === "overrides")
    .map((e: any) => ({
      member: String(e.source ?? ""),
      target: String(e.target ?? ""),
      external: (e.metadata as any)?.isExternalBase === true,
      conf: Number(e.confidence ?? 0),
    }))
  return { rows }
}

let failures = 0
const fail = (m: string): void => { failures++; console.error(`FAIL ${m}`) }
const ok = (m: string): void => console.log(`  ok  ${m}`)

console.log("=== PROJECT A — the project DECLARES `class Object` (the dart:core shape)")
const a = await run(true)
for (const row of a.rows) {
  console.log(`  row: ${row.member} -> ${row.target}  external=${row.external}  conf=${row.conf}`)
}
const aExternal = a.rows.filter((r) => r.external)
if (a.rows.length === 0) fail("project A produced NO overrides row — the probe is not exercising the retarget")
if (aExternal.length === 0) ok("NOT ONE external claim — the project publishes `Object`, so the claim would be false")
else fail(`${aExternal.length} external claim(s) in a project that PUBLISHES Object — the retarget still assumes the project does not`)
if (a.rows.some((r) => r.conf === 0.95)) ok("a project-verified base carries the index-verified confidence (0.95)")
else fail("no project-verified confidence (0.95) — the retarget did not verify the base against the project")

console.log("\n=== PROJECT B — the project DOES NOT declare `Object`")
const b = await run(false)
for (const row of b.rows) {
  console.log(`  row: ${row.member} -> ${row.target}  external=${row.external}  conf=${row.conf}`)
}
const bExternal = b.rows.filter((r) => r.external)
if (bExternal.length === b.rows.length && b.rows.length > 0) ok(`all ${bExternal.length} row(s) are external claims — the project does NOT publish Object, so the claim is TRUE`)
else fail(`only ${bExternal.length} of ${b.rows.length} row(s) are external claims in a project that does NOT publish Object — the fix over-corrected`)

console.log(failures === 0 ? "\nPASS" : `\nFAIL — ${failures} control(s) failed`)
if (failures === 0) rmSync(WORK, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 3)
