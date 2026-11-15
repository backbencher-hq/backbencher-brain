/**
 * ZIG — the population lost with the RECEIVER. How many `uses`/`calls`/`references`
 * edges name the LEAF of a dotted path whose root is a local `@import` binding?
 *
 * ## Why this file exists
 *
 * `const std = @import("std");` is the most common binding form in Zig, and this
 * analyzer records the import's MODULE PATH (`imports`/`references` target `std`,
 * source `(global)`) while discarding WHICH LOCAL NAME it bound. So a read through
 * that alias — `std.mem.Allocator`, `std.debug.print`, `std.Build.Step.dependOn` —
 * is published as its bare leaf (`Allocator`, `print`, `dependOn`), and the edge is
 * indistinguishable from a call to a same-named local function.
 *
 * `script/m14/diagnose-incoming.mts` reports cause C ("external") as 404 / 1,024 /
 * 2,585 distinct unresolved targets for zig with 0 module-wildcard shaped, and the
 * zig repo's stored index shows 11,461 unattached `calls` rows and 7,311 unattached
 * `uses` rows. This file measures how much of that population is explained by the
 * dropped receiver, and how much is a genuinely local miss.
 *
 * ## Derivation — INDEPENDENT of the analyzer
 *
 * A regex over the file's own text for the binding form, then a test for the dotted
 * use of that alias. It shares no code with the tree walk in
 * `src/ast/real-zig-analyzer.ts`, so a tree-walk bug cannot hide inside it: if the
 * analyzer and this file agree on the binding and both are wrong, the grammar has to
 * be wrong, which is a different and much rarer defect. Stated because two copies
 * that agree prove less than two copies that disagree.
 *
 *   LOCAL MODULE   the module path is relative or ends `.zig`/`.zon` — the alias
 *                  names a file in this project, so a read through it IS a local
 *                  reference and must stay un-marked.
 *   EXTERNAL       the module path is a BARE name (`std`, `builtin`, `testing`,
 *                  `posix`, a build-system module) — it names something outside the
 *                  project by construction, so no local declaration can ever bind it.
 *
 * ## What it reports
 *
 * Per relationship type, over distinct (source, target) pairs:
 *
 *   pairs            total
 *   aliasExternal    the pair's leaf is reached through an EXTERNAL alias in the
 *                    same file, on the pair's own line — the dropped-receiver class
 *   aliasLocal       the same through a LOCAL alias
 *   leafUnqualified  neither: the leaf is not written as `alias.…leaf` anywhere on
 *                    the edge's line
 *
 * aliasExternal and aliasLocal both imply leafUnqualified is false, and the report
 * prints the partition identity so the three cannot be double-counted.
 *
 * ## Population
 *
 * `find <root> -name '*.zig' | sort | head -N`, root printed with every number.
 * Instrument: `parseFile` from `src/ast/pool-worker`.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/alias-receiver-probe.ts <root> [N] [--out p]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const positional = argv.filter((a) => !a.startsWith("--"))
const flag = (k: string, d: string) => {
  const hit = argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
  if (hit === undefined) return d
  const eq = hit.indexOf("=")
  return eq === -1 ? (argv[argv.indexOf(hit) + 1] ?? d) : hit.slice(eq + 1)
}
const root = positional[0] ?? "/home/ishaq2321/bb_tests/repositories"
const N = Number(positional[1] ?? 300)
const out = flag("out", "")

const files = execFileSync("bash", ["-lc", `find ${root} -name '*.zig' -type f | sort | head -${N}`], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .trim()
  .split("\n")
  .filter(Boolean)

/** `const NAME = @import("path")` / `var` / `pub const`; also `usingnamespace` is
 *  a FILE-scope use of every member, which is a different edge type and not counted here. */
const BINDING = /(?:^|[^\w$])(?:pub\s+)?(?:const|var)\s+([A-Za-z_][\w]*)\s*(?::[^=]*)?=\s*@(?:cImport|import)\s*\(\s*(["'])([^"']*)\2/g
/** `NAME.rest.of.path` with at least one dot, and `NAME` as the ROOT — not `x.NAME`. */
const QUALIFIED = (alias: string, leaf: string) => {
  const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const leafEsc = leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`\\b${esc}(?:\\s*\\.\\s*\\w+)*\\s*\\.\\s*${leafEsc}\\b`)
}
const isExternalModule = (p: string) =>
  // a relative path, a file path, or a path with a separator names something in this project
  !(p.startsWith(".") || p.startsWith("/") || p.includes("/") || p.endsWith(".zig") || p.endsWith(".zon"))

type Bucket = {
  pairs: number
  aliasExternal: number
  aliasLocal: number
  leafUnqualified: number
  aliasExternalLeafPublished: number
  targetQualifiedWithAlias: number
}
const buckets = new Map<string, Bucket>()
const externalExamples = new Map<string, Set<string>>()
const modules = new Map<string, number>()
/** every published bare name in the SAMPLE, accumulated across files, so the last
 *  file's verdict for an aliasExternal pair can say whether its leaf is a name some
 *  declaration in the window publishes at all. */
const sampleNames = new Set<string>()
let symbols = 0
let parsed = 0
let failed = 0
let filesWithAlias = 0
/** per-file: pairs already attributed, so a pair counted once even at two lines */
const seenPerFile = new Set<string>()

for (const f of files) {
  const text = readFileSync(f, "utf8")
  const lines = text.split("\n")
  /** alias name -> module path */
  const aliases = new Map<string, string>()
  BINDING.lastIndex = 0
  for (let m = BINDING.exec(text); m; m = BINDING.exec(text)) {
    aliases.set(m[1], m[3])
    modules.set(m[3], (modules.get(m[3]) ?? 0) + 1)
  }
  if (aliases.size > 0) filesWithAlias++

  let r: any
  try {
    r = await parseFile(f, root)
    parsed++
  } catch {
    failed++
    continue
  }
  const fileNames = new Set<string>()
  for (const s of r?.symbols ?? []) {
    const n = String(s?.name ?? "")
    if (n) { symbols++; fileNames.add(n); sampleNames.add(n) }
  }

  seenPerFile.clear()
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    const type = String(e?.type ?? "")
    if (!t || (type !== "uses" && type !== "calls" && type !== "references")) continue
    const src = String(e?.source ?? "")
    const key = `${type}|${src}|${t}`
    if (seenPerFile.has(key)) continue
    seenPerFile.add(key)

    let b = buckets.get(type)
    if (!b)
      buckets.set(
        type,
        (b = {
          pairs: 0,
          aliasExternal: 0,
          aliasLocal: 0,
          leafUnqualified: 0,
          aliasExternalLeafPublished: 0,
          targetQualifiedWithAlias: 0,
        }),
      )
    b.pairs++

    // the edge's own line, and failing that the file, because the analyzer publishes the
    // SITE line and the receiver is written on it
    const lineNo = Number(e?.line_number ?? 0)
    const line = lineNo > 0 && lineNo <= lines.length ? lines[lineNo - 1] : ""
    const hay = line || text

    // The QUESTION is a property of the SOURCE, not of the published spelling: "is
    // this leaf written `alias…leaf` here?". So the leaf is the LAST dotted segment
    // of the target, which makes the buckets identical before and after the
    // analyzer starts publishing the qualified path — otherwise a fix that rewrote
    // 1,690 targets would read as 1,690 edges that vanished, which is the shape of
    // a self-fulfilling measurement.
    const leafName = t.slice(t.lastIndexOf(".") + 1)
    const matched: string[] = []
    for (const alias of aliases.keys()) if (QUALIFIED(alias, leafName).test(hay)) matched.push(alias)
    // an external binding wins over a local one for the SAME leaf: the two readings
    // are of the same text and only one of them is outside the project
    const extAlias = matched.find((a) => isExternalModule(aliases.get(a) ?? ""))
    const hit: "external" | "local" | null =
      extAlias !== undefined ? "external" : matched.length > 0 ? "local" : null
    const hitAlias = extAlias ?? matched[0] ?? ""
    // the analyzer now spells the receiver into the target for exactly this class
    const targetHead = t.includes(".") ? t.split(".")[0]! : ""
    if (targetHead !== "" && aliases.has(targetHead) && isExternalModule(aliases.get(targetHead)!)) {
      b.targetQualifiedWithAlias++
    }
    if (hit === "external") {
      b.aliasExternal++
      // the collision that decides whether this is bookkeeping or a wrong binding:
      // a leaf that SOME declaration in the window publishes is indistinguishable
      // from a local call to that declaration, and the store's `misattached` counter
      // CANNOT see it because the names match
      if (sampleNames.has(leafName)) b.aliasExternalLeafPublished++
      let ex = externalExamples.get(type)
      if (!ex) externalExamples.set(type, (ex = new Set()))
      if (ex.size < 6) ex.add(`${hitAlias} -> ${t}`)
    } else if (hit === "local") {
      b.aliasLocal++
    } else {
      b.leafUnqualified++
    }
  }
}

const rows = [...buckets.entries()].sort((a, b) => b[1].pairs - a[1].pairs)
const totals = rows.reduce(
  (a, [, r]) => ({
    pairs: a.pairs + r.pairs,
    aliasExternal: a.aliasExternal + r.aliasExternal,
    aliasLocal: a.aliasLocal + r.aliasLocal,
    leafUnqualified: a.leafUnqualified + r.leafUnqualified,
    aliasExternalLeafPublished: a.aliasExternalLeafPublished + r.aliasExternalLeafPublished,
    targetQualifiedWithAlias: a.targetQualifiedWithAlias + r.targetQualifiedWithAlias,
  }),
  { pairs: 0, aliasExternal: 0, aliasLocal: 0, leafUnqualified: 0, aliasExternalLeafPublished: 0, targetQualifiedWithAlias: 0 },
)

console.log(`population: ${files.length} files listed, ${parsed} parsed, ${failed} failed, ${symbols} symbols`)
console.log(`root: ${root}`)
console.log(`files carrying a ` + "`const X = @import(...)`" + ` binding: ${filesWithAlias}`)
console.log()
console.log(`type              pairs  aliasExternal  aliasLocal  leafUnqualified   ext%  extLeafPub  targetQualified`)
for (const [type, b] of rows) {
  console.log(
    `${type.padEnd(16)} ${String(b.pairs).padStart(6)} ${String(b.aliasExternal).padStart(14)} ${String(b.aliasLocal).padStart(11)} ${String(b.leafUnqualified).padStart(15)} ${String(b.pairs ? Math.round((100 * b.aliasExternal) / b.pairs) : 0).padStart(6)} ${String(b.aliasExternalLeafPublished).padStart(12)} ${String(b.targetQualifiedWithAlias).padStart(17)}`,
  )
}
console.log(
  `${"TOTAL".padEnd(16)} ${String(totals.pairs).padStart(6)} ${String(totals.aliasExternal).padStart(14)} ${String(totals.aliasLocal).padStart(11)} ${String(totals.leafUnqualified).padStart(15)} ${String(totals.pairs ? Math.round((100 * totals.aliasExternal) / totals.pairs) : 0).padStart(6)} ${String(totals.aliasExternalLeafPublished).padStart(12)} ${String(totals.targetQualifiedWithAlias).padStart(17)}`,
)
console.log()
console.log("partition identity: aliasExternal + aliasLocal + leafUnqualified =", totals.aliasExternal + totals.aliasLocal + totals.leafUnqualified, "vs pairs", totals.pairs)
console.log()
console.log("module paths bound most often:")
for (const [m, c] of [...modules.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(c).padStart(5)}  ${JSON.stringify(m)}${isExternalModule(m) ? "  EXTERNAL" : "  local"}`)
}
console.log()
console.log("examples (alias-rooted leaf -> published target):")
for (const [type, ex] of [...externalExamples.entries()]) console.log(`  ${type}: ${[...ex].map((s) => `"${s}"`).join(" ")}`)

if (out) {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(
    out,
    JSON.stringify(
      {
        population: { root, filesListed: files.length, parsed, failed, symbols, filesWithAlias },
        note:
          "one row per (type, source, target) triple per file. aliasExternal = the leaf is written `alias...leaf` on the " +
          "edge's own line and the alias binds an @import of a BARE module path, so no local declaration can bind it.",
        totals,
        perType: Object.fromEntries(rows),
        modulePaths: [...modules.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([m, c]) => ({ module: m, count: c, external: isExternalModule(m) })),
      },
      null,
      2,
    ),
  )
  console.error(`\nwrote ${out}`)
}