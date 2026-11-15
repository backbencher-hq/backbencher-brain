/**
 * M13 REGRESSION MUTANTS — the file-container fixture must be able to FAIL.
 *
 * `script/m14/mutate-analyzer.ts` is shared machinery (§8), so these live here,
 * in the lane, exactly as the Z65 mutants do and for the same reason: a mutant
 * list is only evidence if the harness that reads it is the lane's own.
 *
 * **This harness imports `matchConstraints` from `script/m14/run-fixtures.ts`
 * rather than re-implementing the comparison**, for the reason the Z65 file
 * states: a harness that restates the matcher can pass a mutant the real runner
 * would catch, and then the log says "caught" while the suite disagrees. The
 * only thing this file decides is whether a mutant SURVIVES.
 *
 * The subject is the `@This()` file-as-struct shape: a `container_field` whose
 * direct parent is `source_file`, which the analyzer skipped for want of an
 * enclosing container. Each mutant below is a way an implementation of that
 * shape could be wrong in a way the fixture's positive rows alone would not
 * notice:
 *
 *   M1 field-dropped          the field is never published at all. This is the
 *                             pre-change behaviour verbatim, and it is what the
 *                             9 other fixtures cannot see: they contain no
 *                             file-level field.
 *   M2 owner-from-the-path    the owner is invented from the file's basename
 *                             rather than read from `const X = @This()`, so the
 *                             ownership edge names a symbol nothing publishes.
 *   M3 owner-always           the owner is asserted even when the file does not
 *                             bind `@This()`. Invisible to this fixture, which
 *                             binds it — so it is asserted on a SECOND source
 *                             below, and the harness runs the same matcher over
 *                             both.
 *   M4 nearest-declaration     a file-level field is attributed to the nearest
 *                             named declaration in the file instead of to the
 *                             file's own container, which double-publishes
 *                             `inner` and `get` under `Widget`.
 *   M5 untyped-field-is-a-prop the no-`type`-field case (an enum member) is
 *                             published as a `Property`, so `targetKind` on the
 *                             ownership edge reads `property` where the field
 *                             discriminators say `enum_member`.
 *   M6 scope-flipped          the field is published correctly and the
 *                             `targetScope` annotation is dropped, so the read
 *                             at `self.count` claims to be file-external. The
 *                             negative counterpart of the row the fixture
 *                             exists for: dropping the edge and mislabelling it
 *                             must both be caught.
 *
 * Exit non-zero if any mutant survives, and non-zero if the unmutated fixture
 * is already red — a red baseline makes every result below meaningless.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/m13-mutants.mts
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"
import { matchConstraints } from "../../../../script/m14/run-fixtures"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, "file-container-fields.zig")
const ENUM_FIXTURE = path.join(HERE, "file-container-enum.zig")
const EXPECT = JSON.parse(readFileSync(path.join(HERE, "file-container-fields.expectation.json"), "utf8"))
const ENUM_EXPECT = JSON.parse(readFileSync(path.join(HERE, "file-container-enum.expectation.json"), "utf8"))

/** M3 needs a second source: the same shape with NO `@This()` binding, where the
 *  owner is not nameable and no `contains` edge may be emitted.
 *
 *  It goes in a TEMP DIRECTORY, not beside the fixture. A first revision wrote it
 *  to `validation/m14/fixtures/zig/.m13-nobind.zig`, and `run-fixtures.ts` picks
 *  every `.zig` in that directory up as a fixture — so the next lane's fixture run
 *  reported `FAIL zig/.m13-nobind — missing expectation file`, and the failure
 *  looked like an analyzer defect rather than a harness leaving litter in the
 *  corpus it measures. */
const SCRATCH = mkdtempSync(path.join(tmpdir(), "m13-mutants-"))
const NOBIND = path.join(SCRATCH, "nobind.zig")
const NOBIND_SRC = [
  'const std = @import("std");',
  "loose: u8 = 0,",
  "other: u16 = 1,",
  "pub fn read(self: @This()) u8 {",
  "    return self.loose;",
  "}",
].join("\n")

type Rels = { relationships?: any[]; symbols?: any[] }
type Mutant = { id: string; description: string; transform: (r: Rels) => Rels; extra?: { fixture: string; root: string; expect: any } }

/** How many of the fixture's assertions the runner's own matcher fails. */
const failedAssertions = (result: any, expect: any): number => {
  let fails = 0
  for (const group of ["expectRelationships", "forbidRelationships", "expectSymbols", "forbidSymbols"] as const) {
    for (const entry of expect[group] ?? []) {
      const items = group.endsWith("Symbols") ? (result.symbols ?? []) : (result.relationships ?? [])
      const hit = items.some((x: any) => matchConstraints(x, entry))
      if (group.startsWith("expect") ? !hit : hit) fails++
    }
  }
  return fails
}

const FILE_LEVEL_NAMES = ["count", "name", "allocator", "owner"]

const MUTANTS: Mutant[] = [
  {
    id: "m13/field-dropped",
    description:
      "a file-level field is never published. This is the pre-change behaviour verbatim, and no other fixture in this lane contains a file-level field, so only this one can see it.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).filter((s: any) => !FILE_LEVEL_NAMES.includes(s.name)),
      relationships: (r.relationships ?? []).filter((x: any) => !FILE_LEVEL_NAMES.includes(x.target)),
    }),
  },
  {
    id: "m13/owner-from-the-path",
    description:
      "the owner is taken from the file's basename rather than from `const X = @This()`. The field is still published and every read still resolves, so only the ownership edge's SOURCE is wrong — and it names a symbol the analyzer never publishes, which is an edge the graph asserts and cannot walk.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => (FILE_LEVEL_NAMES.includes(s.name) ? { ...s, ownerName: "file-container-fields", scope: "file-container-fields" } : s)),
      relationships: (r.relationships ?? []).map((x: any) => (x.type === "contains" && FILE_LEVEL_NAMES.includes(x.target) ? { ...x, source: "file-container-fields" } : x)),
    }),
  },
  {
    id: "m13/owner-always",
    description:
      "the owner is asserted even when the file never binds `@This()`, so the fields get a `contains` edge from a container the file never names. Measured on a SECOND source rather than asserted in prose: 10 of the 411 corpus files that declare file-level fields bind no name, and for those the owner is not knowable from the file. The edge names a symbol the analyzer does not publish, so the graph would assert a containment it cannot walk.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => (s.ownerName === undefined && s.kind === "property" ? { ...s, ownerName: "nobind", scope: "nobind", ownerKind: "type" } : s)),
      relationships: [
        ...(r.relationships ?? []),
        { type: "contains", source: "nobind", target: "loose", confidence: 1, metadata: { relationshipType: "zig_ownership", evidenceClass: "structural", targetScope: "file-local", targetKind: "property" } },
        { type: "contains", source: "nobind", target: "other", confidence: 1, metadata: { relationshipType: "zig_ownership", evidenceClass: "structural", targetScope: "file-local", targetKind: "property" } },
      ],
    }),
    extra: {
      fixture: NOBIND,
      root: SCRATCH,
      expect: {
        expectSymbols: [
          { name: "loose", kind: "property" },
          { name: "other", kind: "property" },
        ],
        expectRelationships: [
          { type: "uses", source: "read", target: "loose", "meta.targetScope": "file-local" },
        ],
        forbidRelationships: [
          { type: "contains", target: "loose" },
          { type: "contains", target: "other" },
        ],
      },
    },
  },
  {
    id: "m13/nearest-declaration",
    description:
      "a file-level field is attributed to the nearest NAMED declaration in the file instead of to the file's own container. This double-publishes the ordinary struct's members: `inner` and `get` come out owned by `Widget` as well as by `Nested`.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => (["inner", "get"].includes(s.name) ? { ...s, ownerName: "Widget", scope: "Widget" } : s)),
      relationships: (r.relationships ?? []).map((x: any) => (x.type === "contains" && ["inner", "get"].includes(x.target) ? { ...x, source: "Widget" } : x)),
    }),
  },
  {
    id: "m13/untyped-field-is-a-property",
    description:
      "a field with no `type` field is published as a `Property`. The grammar uses one node type for `a: u8` and for `north`, and only the former carries a type, so this reads an enum member as a struct field — the exact confusion the `type`-field discriminator exists to prevent. It cannot be seen on the struct fixture, which has no untyped field, so it is measured against the ENUM fixture instead.",
    transform: r => ({
      ...r,
      symbols: (r.symbols ?? []).map((s: any) => (s.kind === "enum_member" ? { ...s, kind: "property" } : s)),
      relationships: (r.relationships ?? []).map((x: any) => {
        if (x.type !== "contains") return x
        const md = { ...(x.metadata ?? {}) }
        if (md.targetKind === "enum_member") md.targetKind = "property"
        return { ...x, metadata: md }
      }),
    }),
    extra: { fixture: ENUM_FIXTURE, root: HERE, expect: ENUM_EXPECT },
  },
  {
    id: "m13/scope-flipped",
    description:
      "the field is published correctly and the `targetScope` annotation is dropped, so `self.count` claims to be file-external. A forbid row alone cannot catch this — dropping the edge entirely would also satisfy it — which is why the fixture carries the positive `targetScope: file-local` row this mutant breaks.",
    transform: r => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        const md = { ...(x.metadata ?? {}) }
        if (md.targetScope) { md.targetScope = "file-external"; delete md.targetKind; delete md.targetKindCount }
        return { ...x, metadata: md }
      }),
    }),
  },
]

writeFileSync(NOBIND, NOBIND_SRC)
try {
  const original: any = await parseFile(FIXTURE, HERE)
  const baseline = failedAssertions(original, EXPECT) + failedAssertions(await parseFile(ENUM_FIXTURE, HERE), ENUM_EXPECT)
  console.log(`M13 regression mutants — fixtures ${EXPECT.fixtureId} + ${ENUM_EXPECT.fixtureId} against the REAL production parseFile`)
  console.log(`  baseline (unmutated): ${baseline} failing assertion(s)${baseline === 0 ? " — the fixtures pass, so a failure below is attributable to the mutant" : "  <-- A FIXTURE IS RED BEFORE ANY MUTANT; every result below is meaningless"}\n`)
  if (baseline !== 0) process.exit(2)

  let survived = 0
  for (const m of MUTANTS) {
    let fails = failedAssertions(m.transform(original), EXPECT)
    if (m.extra) {
      const target: any = await parseFile(m.extra.fixture, m.extra.root)
      fails += failedAssertions(m.transform(target), m.extra.expect)
    }
    const caught = fails > 0
    if (!caught) survived++
    console.log(`  ${caught ? "CAUGHT  " : "SURVIVED"} ${m.id.padEnd(34)} ${fails} assertion(s) fail`)
    console.log(`           ${m.description}`)
  }
  console.log(`\n${MUTANTS.length - survived} of ${MUTANTS.length} CAUGHT`)
  if (survived) {
    console.error(`\n${survived} mutant(s) SURVIVED: a fixture is not measuring what it claims.`)
    process.exit(2)
  }
} finally {
  // The scratch directory goes even on a non-zero exit. A `.zig` file left inside
  // `validation/m14/fixtures/zig/` is picked up by the next `run-fixtures.ts` as
  // a fixture with no expectation file, and the failure reads as an analyzer
  // defect rather than as litter.
  try { rmSync(SCRATCH, { recursive: true, force: true }) } catch { /* nothing to remove */ }
}
