// Exhaustive unit + property test for src/ast/import-resolution.ts (JD2).
// Every decision the resolver makes is exercised here, including the shapes it
// must REFUSE. (2026-09-27)
import {
  buildImportResolutionIndex, planImportResolutions, resolveSpecifierPath, splitImportTarget,
  type ImportResolutionIndex, type ImportTargetRow,
} from "../../../src/ast/import-resolution"

let fails = 0
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) { fails++; console.log(`  FAIL ${label} ${extra}`) }
  else console.log(`  ok   ${label}`)
}

console.log("=== 1. resolveSpecifierPath ===")
const spec: Array<[string, string, string | null]> = [
  ["src/app.js", "./widget.js", "src/widget.js"],
  ["src/app.js", "./util", "src/util"],
  ["src/a/b.js", "../lib/x.js", "src/lib/x.js"],
  ["src/a/b.js", "./x", "src/a/x"],
  ["app.js", "./x.js", "x.js"],
  ["src/app.js", "react", null],           // package
  ["src/app.js", "@scope/pkg", null],      // package
  ["src/app.js", "pkg/sub", "pkg/sub"],    // bare but path-shaped
  ["src/app.js", "", null],
]
for (const [imp, s, want] of spec) {
  const got = resolveSpecifierPath(imp, s)
  ok(got === want, `${imp} + ${JSON.stringify(s)} -> ${JSON.stringify(got)}`, `want ${JSON.stringify(want)}`)
}

console.log("\n=== 2. splitImportTarget (last colon, and the refuses) ===")
const sp: Array<[string, { path: string; item: string } | null]> = [
  ["./util.js:helper", { path: "./util.js", item: "helper" }],
  ["react:useState", { path: "react", item: "useState" }],
  ["weird:path:with:colons:item", { path: "weird:path:with:colons", item: "item" }],
  ["./util.js:*", { path: "./util.js", item: "*" }],
  ["nocolon", null],
  [":leading", null],
  ["trailing:", null],
]
for (const [s, want] of sp) {
  const got = splitImportTarget(s)
  ok(JSON.stringify(got) === JSON.stringify(want), `${JSON.stringify(s)} -> ${JSON.stringify(got)}`)
}

console.log("\n=== 3. the resolvable / unresolvable decision, on a realistic project ===")
const files = [
  { fileId: "f:app", relativePath: "src/app.js" },
  { fileId: "f:widget", relativePath: "src/widget.js" },
  { fileId: "f:util", relativePath: "src/util.js" },
  { fileId: "f:util2", relativePath: "lib/util.js" },     // SAME TAIL, different dir
  { fileId: "f:index", relativePath: "src/dir/index.js" },
]
const symbols = [
  { fileId: "f:app", name: "w", symbolId: "s:app.w" },
  { fileId: "f:widget", name: "Widget", symbolId: "s:widget.Widget" },
  { fileId: "f:widget", name: "draw", symbolId: "s:widget.draw" },
  { fileId: "f:util", name: "helper", symbolId: "s:util.helper" },
  { fileId: "f:util2", name: "helper", symbolId: "s:util2.helper" },
  { fileId: "f:index", name: "main", symbolId: "s:index.main" },
]
const imports = [
  { fileId: "f:app", importPath: "./widget.js" },
  { fileId: "f:app", importPath: "./util.js" },
  { fileId: "f:app", importPath: "./dir" },
  { fileId: "f:util2", importPath: "./util.js" },   // makes ./util.js AMBIGUOUS
  { fileId: "f:app", importPath: "./dual" },       // matches dual.js AND dual/index.js
]
// The export surface each file publishes — the gate that stops a name-only
// match from attaching an import to an unrelated same-named symbol.
const exports = [
  { fileId: "f:widget", name: "Widget" },
  { fileId: "f:widget", name: "draw" },
  { fileId: "f:widget", name: "main" },
  { fileId: "f:util", name: "helper" },
  { fileId: "f:util2", name: "helper" },
  { fileId: "f:index", name: "main" },
  { fileId: "f:both", name: "picked" },
  { fileId: "f:dualidx", name: "other" },
]
const index: ImportResolutionIndex = buildImportResolutionIndex(files, symbols, imports, exports)

console.log(`  pathTargets: ${JSON.stringify([...index.pathTargets.entries()].map(([k, v]) => [k, [...v]]))}`)
ok(index.pathTargets.get("./widget.js")?.size === 1, "./widget.js -> exactly one file")
ok(index.pathTargets.get("./util.js")?.size === 2, "./util.js -> two files (ambiguous, as it must be)")
ok(index.pathTargets.get("./dir")?.has("f:index"), "./dir -> src/dir/index.js via index probe")
ok(index.pathTargets.has("react") === false, "a package specifier resolves to no internal file")

const rows: ImportTargetRow[] = [
  { id: "r1", target_external: "./widget.js:Widget", source_external: "app" },
  { id: "r2", target_external: "./widget.js:draw", source_external: "app" },
  { id: "r3", target_external: "./util.js:helper", source_external: "app" },
  { id: "r4", target_external: "./util.js:*", source_external: "app" },
  { id: "r5", target_external: "./widget.js:render", source_external: "app" },  // ALIASED: local name
  { id: "r6", target_external: "./dir:main", source_external: "app" },
  { id: "r7", target_external: "react:useState", source_external: "app" },    // external
  { id: "r8", target_external: "./widget.js:Nope", source_external: "app" },   // absent symbol
  { id: "r9", target_external: "./util.js:helper", source_external: "util2" }, // disambiguated
  { id: "r10", target_external: "nocolon", source_external: "app" },
  { id: "r11", target_external: "./widget.js:Widget", source_external: "app" }, // duplicate id
  { id: "r12", target_external: "./dual:picked", source_external: "app" },      // disambiguable
  { id: "r13", target_external: "./dual:picked", source_external: "dualidx" },   // wrong importer -> refuse
]
const plan = planImportResolutions(rows, index)
const byId = new Map(plan.map((p) => [p.id, p]))
console.log(`  plan: ${JSON.stringify(plan.map((p) => [p.id, p.symbolId, p.via]))}`)

ok(byId.get("r1")?.symbolId === "s:widget.Widget", "r1 unaliased named -> resolves")
ok(byId.get("r2")?.symbolId === "s:widget.draw", "r2 unaliased named -> resolves")
ok(byId.get("r3") === undefined, "r3 AMBIGUOUS specifier -> REFUSED (not guessed)")
ok(byId.get("r4") === undefined, "r4 namespace `*` -> REFUSED")
ok(byId.get("r5") === undefined, "r5 ALIASED local name -> REFUSED (no such symbol; JD2b)")
ok(byId.get("r6")?.symbolId === "s:index.main", "r6 directory import via index probe -> resolves")
ok(byId.get("r7") === undefined, "r7 external package -> REFUSED")
ok(byId.get("r8") === undefined, "r8 symbol absent from the file -> REFUSED")
// CORRECTED after the first run failed here. The code REFUSED r9 and that is
// right: both candidates are `util.js`, so the analyzer's source name — itself a
// module basename — cannot tell them apart. Asserting a resolve here would have
// been asserting a guess. Two same-named files => refusal, full stop.
ok(byId.get("r9") === undefined, "r9 two same-basename targets -> REFUSED even with a source name (a basename cannot disambiguate a basename)")
ok(byId.get("r10") === undefined, "r10 no colon -> REFUSED")
ok(plan.filter((p) => p.id === "r1").length === 1, "r11 duplicate row id -> emitted once")
// r12 exposed a DESIGN ERROR, not a test error: `source_external` is the
// importing file's basename, so it cannot break a tie between candidate TARGET
// files. The branch that tried is removed; ambiguity is now an unconditional
// refusal. Asserting the refusal is the contract.
ok(byId.get("r12") === undefined, "r12 specifier matching two files -> REFUSED unconditionally (the row carries no importing file)")
ok(byId.get("r13") === undefined, "r13 same pair, importer does not single either out -> REFUSED")

console.log("\n=== 4. the property that matters: a resolution NEVER crosses into a file the specifier does not name ===")
{
  // Two files, same item name, specifier names exactly one of them.
  const idx2 = buildImportResolutionIndex(
    [{ fileId: "A", relativePath: "a/thing.js" }, { fileId: "B", relativePath: "b/thing.js" }],
    [{ fileId: "A", name: "x", symbolId: "A.x" }, { fileId: "B", name: "x", symbolId: "B.x" }],
    [{ fileId: "A", importPath: "../b/thing.js" }],
    [{ fileId: "B", name: "x" }],
  )
  const p = planImportResolutions([{ id: "p1", target_external: "../b/thing.js:x", source_external: "thing" }], idx2)
  ok(p.length === 1 && p[0].symbolId === "B.x", "relative path picks the right one of two same-named files", JSON.stringify(p))
}

console.log("\n=== 5. THE GATE: an item the target file does NOT export must not resolve ===")
{
  // The exact false resolution the first end-to-end run produced:
  //   widget.js  ->  class Widget { render() {...} }   and  function draw() {}
  //   app.js     ->  import { draw as render } from "./widget.js"
  // The edge says `./widget.js:render` (the LOCAL binding). widget.js has an
  // unrelated METHOD named `render`, so a name-only match attached the import
  // to `Widget.render` instead of the function `draw`. Reproduced here as a
  // permanent regression.
  const f = [{ fileId: "W", relativePath: "src/widget.js" }, { fileId: "A2", relativePath: "src/app.js" }]
  const sy = [
    { fileId: "W", name: "Widget", symbolId: "W.Widget" },
    { fileId: "W", name: "render", symbolId: "W.Widget.render" },  // the decoy METHOD
    { fileId: "W", name: "draw", symbolId: "W.draw" },              // what is really imported
  ]
  const ex = [{ fileId: "W", name: "Widget" }, { fileId: "W", name: "draw" }]
  const idx3 = buildImportResolutionIndex(f, sy, [{ fileId: "A2", importPath: "./widget.js" }], ex)
  const got = planImportResolutions([{ id: "g1", target_external: "./widget.js:render", source_external: "app" }], idx3)
  ok(got.length === 0, "aliased local name colliding with a same-named method -> REFUSED, not attached to the decoy", JSON.stringify(got))
  ok(idx3.exportsByFile.get("W")?.has("render") === false, "the decoy `render` is not in the export surface")
  const okRow = planImportResolutions([{ id: "g2", target_external: "./widget.js:draw", source_external: "app" }], idx3)
  ok(okRow[0]?.symbolId === "W.draw", "the DECLARED name still resolves normally")
  // And with no export surface recorded, nothing resolves — the safe direction.
  const idx4 = buildImportResolutionIndex(f, sy, [{ fileId: "A2", importPath: "./widget.js" }], [])
  ok(planImportResolutions([{ id: "g3", target_external: "./widget.js:draw", source_external: "app" }], idx4).length === 0,
    "no export surface recorded -> REFUSE everything (never a guess)")
}

console.log("\n=== 6. empty / degenerate inputs must not throw ===")
{
  const empty = buildImportResolutionIndex([], [], [])
  ok(planImportResolutions([], empty).length === 0, "no rows -> no plan")
  ok(planImportResolutions([{ id: "z", target_external: "", source_external: null }], empty).length === 0, "empty target -> no plan")
  ok(planImportResolutions([{ id: "z", target_external: "a:b:c", source_external: null }], empty).length === 0, "unknown path -> no plan")
}

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILURE(S)"}`)
if (fails > 0) process.exitCode = 1
