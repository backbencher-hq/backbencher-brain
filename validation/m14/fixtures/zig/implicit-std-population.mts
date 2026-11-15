/**
 * IMPLICIT-STD POPULATION — how many edges name a stdlib module that the file
 * never declared, and so never got marked external?
 *
 * ## The mechanism this measures
 *
 * `zigImportAliases` builds its alias map ONLY from `const X = @import("...")`
 * nodes, and `zigExternalReceiverPath` returns null when the receiver's root is
 * absent from that map. In Zig, `std`, `builtin` and `root` are in scope in every
 * file with NO declaration — they are language-level roots, not imports. So for a
 * file that writes `std.mem.copy(...)` and never says `const std = @import("std")`,
 * the alias lookup misses and the edge publishes the BARE LEAF:
 *
 *     std.mem.copy(...)   ->   uses f->copy        (competes with every `copy`)
 *
 * while the same access in a file that DOES declare `const std` publishes
 * `uses f->std.mem.copy` with `zigExternalRef: true`. The corpus is split across
 * both spellings of the same language rule, so one half of it gets the marker and
 * the other half silently competes for its name.
 *
 * ## Why the gate cares
 *
 * `incoming-gate.ts` declares an external target a DECLARED EXCEPTION and requires
 * the marking to be present; an unmarked external edge is indistinguishable from a
 * broken one. This is the population that marking would cover.
 *
 * ## The refusal, stated so it can be checked
 *
 * A file that binds `std` to something that is NOT `@import` puts `std` in the
 * analyzer's `shadowed` set, which deletes it from the alias map. Those files are
 * counted separately as `rootBoundToNonImport` and are NOT claimed here — the
 * implicit-root reading does not apply to them.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/implicit-std-population.mts [maxFiles]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX = Number(process.argv[2] ?? 200)
const REPOS = (process.env.ZIG_REPOS ?? "zig,ghostty,mold,eastwood,duckdb,oven").split(",")
/** Zig's language-level roots. In scope in every file, declared by no file. */
const IMPLICIT_ROOTS = ["std", "builtin", "root"]

function draw(n: number): string[] {
  const all: string[] = []
  for (const repo of REPOS) {
    const stack = [`${CR}/${repo}`]
    while (stack.length) {
      const d = stack.pop()!
      let ents: string[]
      try { ents = readdirSync(d) } catch { continue }
      for (const e of ents) {
        const p = `${d}/${e}`
        let st
        try { st = statSync(p) } catch { continue }
        if (st.isDirectory()) { if (e !== ".git") stack.push(p) }
        else if (e.endsWith(".zig")) all.push(p.slice(CR.length + 1))
      }
    }
  }
  all.sort()
  const stride = Math.max(1, Math.floor(all.length / n))
  const out: string[] = []
  for (let i = 0; out.length < n && i < all.length; i += stride) out.push(all[i])
  return out
}

const files = draw(MAX)
let filesUsingImplicitRoot = 0, filesDeclaringRoot = 0, filesBindingRootToNonImport = 0
let usesUnmarked = 0, callsUnmarked = 0, usesMarked = 0, callsMarked = 0
const bareLeafNames = new Map<string, number>()
const examples: any[] = []
let edges = 0, parseFail = 0

for (const rel of files) {
  const f = `${CR}/${rel}`
  const src = readFileSync(f, "utf8")
  // does this file use an implicit root at all, and how does it bind it?
  const usesRoot = IMPLICIT_ROOTS.some((r) => new RegExp(`(^|[^\\w.@"'])${r}\\.`).test(src))
  if (!usesRoot) continue
  const binds = new Map<string, "import" | "nonimport">()
  for (const r of IMPLICIT_ROOTS) {
    const re = new RegExp(`const\\s+${r}\\s*(:[^=]*)?=\\s*@import`, "m")
    binds.set(r, re.test(src) ? "import" : "nonimport")
  }
  const anyImport = [...binds.values()].includes("import")
  if (anyImport) filesDeclaringRoot++
  else { filesUsingImplicitRoot++; filesBindingRootToNonImport++ }

  const r2: any = await parseFile(f, "zig")
  if (!r2) { parseFail++; continue }
  for (const e of (r2.relationships ?? []) as any[]) {
    const t = String(e.type)
    if (t !== "uses" && t !== "calls") continue
    edges++
    const tgt = String(e.target)
    const marked = !!e.metadata?.zigExternalRef
    if (marked) { if (t === "uses") usesMarked++; else callsMarked++; continue }
    // unmarked: does the ACCESS SITE name an implicit root? the edge text keeps the
    // expression in metadata for field reads, so test the target and the site text
    const site = String(e.metadata?.fieldAccessExpression ?? e.metadata?.callExpression ?? tgt)
    const siteUsesImplicit = IMPLICIT_ROOTS.some((rt) => new RegExp(`(^|[^\\w.@"'])${rt}\\.`).test(site))
    if (!siteUsesImplicit) continue
    if (t === "uses") usesUnmarked++; else callsUnmarked++
    bareLeafNames.set(tgt, (bareLeafNames.get(tgt) ?? 0) + 1)
    if (examples.length < 25) examples.push({ file: rel, type: t, target: tgt, site: site.slice(0, 60) })
  }
}

const top = [...bareLeafNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
const out = {
  tool: "zig-implicit-std-population",
  population: `${files.length} stride-sampled .zig files of 3834 admitted`,
  files: files.length,
  parseFailures: parseFail,
  filesUsingAnImplicitRoot: filesUsingImplicitRoot + filesDeclaringRoot,
  filesDeclaringTheRootAsAnImport: filesDeclaringRoot,
  filesUsingItWithoutAnyDeclaration: filesUsingImplicitRoot,
  edges_uses_calls: edges,
  markedExternal_uses: usesMarked,
  markedExternal_calls: callsMarked,
  UNMARKED_external_uses: usesUnmarked,
  UNMARKED_external_calls: callsUnmarked,
  unmarkedShareOfUses: usesUnmarked + usesMarked ? usesUnmarked / (usesUnmarked + usesMarked) : 0,
  bareLeafNameCollisions: top,
  examples,
}
writeFileSync("validation/m14/fixtures/zig/measurements/implicit-std-population.json", JSON.stringify(out, null, 2))
console.log(JSON.stringify({ ...out, examples: out.examples.slice(0, 8), bareLeafNameCollisions: out.bareLeafNameCollisions.slice(0, 10) }, null, 2))
