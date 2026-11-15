/**
 * project-index-spec — does `FSHARP_DECLARATION_SPEC` read the F# tree, and does it read it RIGHT?
 *
 * ## Why this exists
 *
 * The F# lane had no `DeclarationSpec`, so `buildProjectIndex*` could not read one F# declaration
 * and the lane's cross-file questions had no instrument: pass 8 measured the cost at 65,215 edges
 * whose name more than one `.fs` in the project declares and 3,689 declared only in `.fsi` files.
 * A spec is DATA about the grammar, and data about a grammar is exactly the kind of artifact that
 * looks right while reading nothing — the first cut of this spec returned `typeKinds.size === 0`
 * for all 12 fixtures, silently, because a clause's `type_name` is an UNNAMED child of the clause
 * (the `type_name` FIELD is one level deeper, on that node's own `identifier`). An index of the
 * right shape holding nothing is indistinguishable from "no declarations here".
 *
 * ## What is asserted, and what each assertion catches
 *
 * 1. THE CONTROL READS NOTHING. The same files are indexed with `SOLIDITY_DECLARATION_SPEC`. If
 *    that run ever produces a type, this file's main assertions are proving nothing about the F#
 *    spec, because something else in the pipeline is finding names.
 * 2. THE FACTS A CROSS-FILE QUESTION READS. For each type named below, its KIND, its own MEMBERS
 *    and its direct BASES, read from the fixtures' own source. The bases are the half that caught
 *    a real defect: a first cut collected `identifier`s in pop order, so `System.IDisposable` was
 *    filed as `System` — the FIRST segment — and `Buffer`'s external base `System.IO.MemoryStream`
 *    as `System`. Field-for-field equality is asserted, so a resolver that starts returning a
 *    prefix fails here rather than in a cross-file answer months later.
 * 3. THE OMISSIONS STAY OMITTED. `type_declaration` (a bodyless forward declaration) and
 *    `type_extension` are deliberately not declaration nodes: including either would let a
 *    signature pair (`Surface.fsi` + `Surface.fs`) or an extension publish a second, kind-less
 *    `Surface` and downgrade the real kind to `unknown` — and the kind is the one field the
 *    downstream question ("is this base an interface?") needs. Asserted by the ABSENCE of a
 *    downgrade on the fixture that writes both shapes.
 * 4. `Shape` IS `unknown` ON PURPOSE. Two fixtures in this population declare `Shape` with
 *    different clause kinds (an abstract-member class and a union), so the index's duplicate-kind
 *    rule records `unknown`. That is `indexTree`'s documented behaviour, not a spec failure, and
 *    pinning it keeps a future edit from "fixing" it by letting the last writer win.
 *
 * It asserts rather than prints, so it can be wired into a gate the day production registers the
 * spec (see the doc's pass 14: the one-line registration in the index path is the next unit, and
 * this fixture cannot gate an analyzer that does not yet read the index).
 *
 * Run: npx tsx validation/m14/fixtures/fsharp/project-index-spec.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"
import {
  buildProjectIndexFromDisk,
  FSHARP_DECLARATION_SPEC,
  SOLIDITY_DECLARATION_SPEC,
} from "../../../../src/ast/project-index"

const ROOT = process.cwd()
const DIR = path.join(ROOT, "validation/m14/fixtures/fsharp")
const WASM = path.join(ROOT, "wasm/tree-sitter-fsharp.wasm")

const files = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".fs"))
  .sort()
  .map((f) => path.join(DIR, f))

const failures: string[] = []
const expect = (what: string, got: unknown, want: unknown): void => {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g !== w) failures.push(`${what}: got ${g}, expected ${w}`)
}

const main = async (): Promise<void> => {
  process.stdout.write(`population: ${files.length} .fs fixtures\n`)

  const control = await buildProjectIndexFromDisk(WASM, files, SOLIDITY_DECLARATION_SPEC)
  process.stdout.write(
    `control (SOLIDITY spec over F# files): types ${control.typeKinds.size}, names ${control.symbolNames.size}\n`,
  )
  if (control.typeKinds.size !== 0 || control.symbolNames.size !== 0) {
    failures.push(
      "control: the Solidity spec read declarations out of F# files, so this fixture is not testing the F# spec",
    )
  }

  const index = await buildProjectIndexFromDisk(WASM, files, FSHARP_DECLARATION_SPEC)
  process.stdout.write(
    `fsharp spec: files ${index.stats.files} damaged ${index.stats.damaged} types ${index.typeKinds.size} ` +
      `with-members ${index.typeMembers.size} with-bases ${index.typeBases.size} names ${index.symbolNames.size}\n`,
  )
  if (index.stats.files !== files.length) {
    failures.push(`files: ${index.stats.files} of ${files.length} were read`)
  }
  if (index.typeKinds.size < 30) {
    failures.push(
      `types: ${index.typeKinds.size} declarations read from 12 fixtures — a spec that reads nothing ` +
        `returns 0, which is the failure this fixture exists to make impossible to ship`,
    )
  }

  // The two CLAUSE-level negatives the kind rule needs, stated as a boundary rather than left to
  // the rows above: a type that could be read as an interface by its MEMBERS alone must not be,
  // because the constructor is what a clause with an instance surface has and an interface never
  // has. Both are real fixtures shapes (`declared-type-graph.fs`), not additions for this pin.
  const interfaceish = ["Animal", "Resource", "Guarded", "Tagged", "Buffer"]
  for (const t of interfaceish) {
    if (index.typeKinds.get(t) !== "class") {
      failures.push(`kind(${t}): ${String(index.typeKinds.get(t))} — a clause with a constructor is not an interface`)
    }
  }

  // FS-P17, the NAME channel. Three claims, and each is a different way the channel can be wrong:
  //
  //   1. F#'s most common declarations are RECORDED — a file-header module (`named_module`, a
  //      DIFFERENT node from `module_defn`), a nested module under its QUALIFIED path (what a file
  //      outside the namespace writes), and a module-level `let` binding.
  //   2. They are recorded as NAMES ONLY: none becomes a type, because a name in `typeKinds` is the
  //      one field the downstream question ("is this base an interface?") reads and a binding is
  //      not a type.
  //   3. A LOCAL is not a declaration, so it must NOT be recorded — the defect the first cut of
  //      this channel shipped, measured (`local` at `call-ownership.fs:67`, `built` at
  //      `call-target-spelling.fs:63`, both inside member bodies).
  for (const name of ["Fixture.Extensions", "Extensions", "Fixture.Extensions.First", "topLevelFunction", "mock"]) {
    if (!index.symbolNames.has(name)) {
      failures.push(`symbolNames: ${name} is not recorded — the name channel (FS-P17) is not reading it`)
    }
  }
  for (const nameOnly of ["Fixture.Extensions", "topLevelFunction", "Fixture.Extensions.First"]) {
    if (index.typeKinds.has(nameOnly)) {
      failures.push(`typeKinds: ${nameOnly} was given a KIND — a name-only declaration must not claim one`)
    }
  }
  for (const local of ["local", "built"]) {
    if (index.symbolNames.has(local)) {
      failures.push(
        `symbolNames: ${local} is a LOCAL binding inside a member body, and a local in the project's ` +
          `name set refines every bare call that happens to match it`,
      )
    }
  }

  const members = (t: string): string[] => [...(index.typeMembers.get(t) ?? [])].sort()
  const bases = (t: string): string[] => [...(index.typeBases.get(t) ?? [])]

  // kinds, from the fixtures' own source shapes.
  //
  // FS-P16 flipped `ITagged` from `class` to `interface`, and the history of THIS ROW is the
  // reason the lane's doctrine says an unpinned class is not pinned at all. Pass 14 asserted
  // `class` — with a comment explaining that `type ITagged = abstract member …` is an
  // `anon_type_defn` — and it was TRUE of the node type and FALSE of the kind: the grammar
  // spells an interface and a class with the same node, so the static map filed every F#
  // interface as a class, and this fixture ENCODED the defect as the expectation. The
  // `interface end` spelling (`NotDeclared`, next row) was pinned and passed, so the suite looked
  // like it covered both spellings. It was found by building the index for the FS-P10 fixture
  // pair and reading `kind(class)` off a type whose own source says `abstract member`.
  for (const [name, kind] of [
    ["Animal", "class"], // a constructor AND concrete members: class evidence twice over
    ["Dog", "class"],
    ["ITagged", "interface"], // abstract members, no constructor -> the SPEC's kindResolver
    ["NotDeclared", "interface"], // `interface end` -> `interface_type_defn`, the spelling pass 14 pinned
    ["Dep", "class"], // `class end`: ZERO members is not an interface
    ["Bad", "class"], // `val mutable …` fields: a member with no `member_signature` is a body
    ["Point", "record"],
    ["Message", "union"],
    ["Alias", "unknown"], // an abbreviation declares a name and no kind of its own
    // two fixtures declare `Shape` with different clause kinds -> indexTree's rule records unknown
    ["Shape", "unknown"],
  ] as const) {
    expect(`kind(${name})`, index.typeKinds.get(name), kind)
  }

  for (const [name, want] of [
    ["Animal", ["Dispose", "Speak"]],
    ["Dog", ["Speak"]],
    ["Resource", ["Dispose", "Tag"]],
    ["Guarded", ["Dispose", "Speak"]],
    ["ITagged", ["Tag"]],
    ["Tagged", ["Tag"]],
  ] as const) {
    expect(`members(${name})`, members(name), [...want].sort())
  }

  for (const [name, want] of [
    ["Dog", ["Animal"]],
    ["Guarded", ["Animal", "IDisposable"]],
    ["Buffer", ["MemoryStream"]], // `inherit System.IO.MemoryStream()` -> the LAST segment
    ["Tagged", ["ITagged"]],
    ["Resource", ["IDisposable"]], // `interface System.IDisposable with` -> the LAST segment
  ] as const) {
    expect(`bases(${name})`, bases(name), [...want])
  }
  // The object expression in `override-target.fs` (`{ new System.IDisposable with … }`) must not
  // publish `Dispose`/`Tag` as members of whatever type encloses the `let`.
  const objectHosts = [...index.typeMembers.entries()].filter(([, ms]) => ms.has("Tag") && ms.has("Dispose"))
  if (objectHosts.some(([t]) => t === "Fixture")) {
    failures.push("object expression: its members were attributed to the enclosing scope")
  }

  if (failures.length > 0) {
    process.stdout.write(`\nFAIL — ${failures.length} assertion(s):\n`)
    for (const f of failures) process.stdout.write(`  ${f}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(
    `\nPASS — the F# spec reads ${index.typeKinds.size} declarations, the control reads 0, and every\n` +
      `kind/member/base above matches the fixtures' source\n`,
  )
}

await main()
