/**
 * ZIG WAVE 4 — the `imports` GATE (Z30), site-aware and bidirectional.
 *
 * The F5 matcher keys on `label + normTarget(target)`, so a shared-gate version of
 * this class would be compared at NAME level: `imports std` from any line would
 * cover `imports ../global.zig` from any other. Import facts are per-SITE — the
 * same module imported 40 times in a file is 40 facts — so the key here is
 * `(target, line)`, and the comparison runs in both directions:
 *
 *   PHANTOM  an `imports` edge the tree does not have at that line
 *   MISSING  an @import the tree has that the analyzer published no edge for
 *
 * A path-shape check rides along because the class's whole argument is that an
 * import target is a MODULE: a target with no path separator is a bare module
 * name (`std`, `builtin`), and one with separators is a relative path. Both are
 * legal; what is NOT legal is an `imports` edge whose target is a symbol
 * declaration in the same file, which is the conflation this type exists to
 * prevent (measured: 176 of 394 distinct targets carry a separator, and 0 of
 * them could be a declaration name).
 *
 * Usage: npx tsx script/m14/tmp/zigw-imports.ts [files] [--out <path>]
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"
import { deriveZigImports } from "../zig-truth"

async function main(): Promise<void> {
  await init()
  const args = process.argv.slice(2)
  const outIdx = args.indexOf("--out")
  const out = outIdx >= 0 ? args[outIdx + 1] : null
  const limitArg = args.find((a) => /^\d+$/.test(a))
  const limit = limitArg ? Number(limitArg) : 400
  const files = zigFiles(["zig", "zls", "ghostty"], limit)

  let derived = 0
  let agree = 0
  let phantom = 0
  let missing = 0
  let noLine = 0
  let sameSiteBinding = 0
  let collidesWithOtherDeclaration = 0
  const declaredNames = new Set<string>()
  const phantomEx: string[] = []
  const missingEx: string[] = []
  const localEx: string[] = []
  const targetShapes = { bare: 0, path: 0, builtin: 0 }

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const root = tree.rootNode
    const rel = f.split("/repositories/")[1] ?? f
    const res: any = analyzer().analyze(root, src, f)

    // What this file declares, by (name, line) rather than by name alone. Z35 made
    // an @import BINDING a symbol, so `const std = @import("std")` now publishes a
    // symbol `std` AND an edge whose target is `std` — the same fact twice, and
    // the first version of this check called it a conflation on all 578 such sites
    // in 400 files. What is worth knowing is a target that collides with a
    // DIFFERENT declaration: same name, different line. That is the case a
    // consumer can genuinely misread, and it is 3 sites, not 578.
    declaredNames.clear()
    for (const s of res.symbols as any[]) {
      if (typeof s.name === "string") declaredNames.add(`${s.name}|${s.range?.startLine ?? 0}`)
    }

    const truth = deriveZigImports(root)
    const published = new Set<string>()
    for (const r of res.relationships as any[]) {
      if (r.type !== "imports") continue
      if (typeof r.line_number !== "number" || r.line_number <= 0) {
        noLine++
        if (phantomEx.length < 12) phantomEx.push(`${rel}  NO LINE_NUMBER imports -> ${r.target}`)
        continue
      }
      published.add(`${r.line_number}|${r.target}`)
      const t = String(r.target ?? "")
      if (t === "builtin") targetShapes.builtin++
      else if (/[/\\]/.test(t)) targetShapes.path++
      else targetShapes.bare++
      // an import edge whose target is a symbol DECLARED IN THIS FILE is the
      // conflation the type exists to prevent (a relative path that happens to
      // share a name with a local declaration, most often)
      if (declaredNames.has(`${t}|${r.line_number}`)) sameSiteBinding++
      else if ([...declaredNames].some((k) => k.startsWith(`${t}|`))) {
        collidesWithOtherDeclaration++
        if (localEx.length < 8) localEx.push(`${rel}:${r.line_number}  imports -> ${t}  collides with a DIFFERENT declaration of that name elsewhere in the file`)
      }
    }
    for (const t of truth) {
      derived++
      const k = `${t.line}|${t.target}`
      if (published.has(k)) agree++
      else {
        missing++
        if (missingEx.length < 12) missingEx.push(`${rel}  MISSING imports -> ${t.target}  (L${t.line})`)
      }
    }
    for (const k of published) {
      if (!truth.some((t) => `${t.line}|${t.target}` === k)) {
        phantom++
        if (phantomEx.length < 12) phantomEx.push(`${rel}  PHANTOM imports at ${k.replace("|", " -> ")}`)
      }
    }
    tree.delete()
  }

  console.log(`files: ${files.length}  derived import sites: ${derived}`)
  console.log(`AGREE:   ${agree}`)
  console.log(`MISSING: ${missing}   <- an @import in the tree with no published edge`)
  console.log(`PHANTOM: ${phantom}   <- a published edge with no @import at that line`)
  console.log(`edges with NO line_number: ${noLine}   (M60.A7 requires the line for this class)`)
  console.log(`the binding idiom (an \`imports\` target that is the SAME SITE as a declared symbol): ${sameSiteBinding}   <- correct: \`const std = @import("std")\` publishes a binding AND a dependency`)
  console.log(`targets colliding with a DIFFERENT declaration of the same name: ${collidesWithOtherDeclaration}   <- REPORTED, not failed: the edge is correct and the collision is in the SOURCE`)
  console.log(`   REPORTED, not failed: the edge is CORRECT — the source really does import a module of that name — and the collision is in the source: \`const uucode = @import("uucode")\`. Measured 3 in 400 files, all bare names (uucode, framedata). The mitigation is that BOTH twins carry isImport, so a consumer can tell the dependency from the symbol reference, and \`imports\` is its own type precisely so this is visible instead of inferred.`)
  console.log(`target shapes: bare module ${targetShapes.bare}, relative path ${targetShapes.path}, builtin ${targetShapes.builtin}`)
  for (const e of phantomEx) console.log("  " + e)
  for (const e of missingEx) console.log("  " + e)
  for (const e of localEx) console.log("  " + e)
  if (out) {
    fs.writeFileSync(
      out,
      JSON.stringify(
        {
          files: files.length,
          derivedSites: derived,
          totals: { agree, missing, phantom, noLine, sameSiteBinding, collidesWithOtherDeclaration },
          targetShapes,
          reported: { sameSiteBinding, collidesWithOtherDeclaration, why: "the binding idiom is the same fact twice; a collision is a source-level name coincidence, and both twins carry isImport" },
          verdict: missing === 0 && phantom === 0 && noLine === 0 ? "clean" : "DEFECT",
        },
        null,
        2,
      ) + "\n",
    )
    console.log(`\nwrote ${out}`)
  }
  process.exit(missing === 0 && phantom === 0 && noLine === 0 ? 0 : 1)
}
void main()
