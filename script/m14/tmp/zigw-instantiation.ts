/**
 * ZIG WAVE 4 — the `instantiates` GATE (Z32), bidirectional and site-keyed.
 *
 * Key: `(source, target, line)`. The source matters here in a way it does not for
 * most classes — the family convention attributes an instantiation to the
 * ENCLOSING symbol, and two sites in the same file with the same target under
 * different owners are two facts, not one. The line is the head node's, the type
 * name's own line, per the same convention clojure states explicitly.
 *
 * Two classes are checked separately, because they are two different facts:
 *   construction             `TypeName{ … }` on an in-file type
 *   generic type application a call to an in-file `fn … type`
 *
 * KNOWN LIMIT, stated rather than left to be inferred from a clean count: only
 * IN-FILE targets are in scope. `std.ArrayList(u8)` and every other qualified or
 * external generic application is a real instantiation that neither side
 * publishes, and measuring it needs a cross-file type index — a different
 * instrument, not a fix here.
 *
 * Usage: npx tsx script/m14/tmp/zigw-instantiation.ts [files] [--out <path>]
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"
import { deriveZigInstantiation } from "../zig-truth"

async function main(): Promise<void> {
  await init()
  const args = process.argv.slice(2)
  const outIdx = args.indexOf("--out")
  const out = outIdx >= 0 ? args[outIdx + 1] : null
  const limitArg = args.find((a) => /^\d+$/.test(a))
  const limit = limitArg ? Number(limitArg) : 400
  const files = zigFiles(["zig", "zls", "ghostty"], limit)

  let agree = 0, phantom = 0, missing = 0, noLine = 0
  const byClass = new Map<string, number>()
  const phantomEx: string[] = [], missingEx: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const root = tree.rootNode
    const rel = f.split("/repositories/")[1] ?? f
    const res: any = analyzer().analyze(root, src, f)
    const truth = deriveZigInstantiation(root)
    const truthKeys = new Set(truth.map((t) => `${t.from}|${t.target}|${t.line}`))
    for (const t of truth) byClass.set(t.class, (byClass.get(t.class) ?? 0) + 1)
    const published = new Set<string>()
    for (const r of res.relationships as any[]) {
      if (r.type !== "instantiates") continue
      if (typeof r.line_number !== "number" || r.line_number <= 0) { noLine++; continue }
      const k = `${r.source}|${r.target}|${r.line_number}`
      published.add(k)
      if (!truthKeys.has(k)) {
        phantom++
        if (phantomEx.length < 12) phantomEx.push(`${rel}  PHANTOM instantiates ${r.source} -> ${r.target} (L${r.line_number})`)
      }
    }
    for (const k of truthKeys) {
      if (!published.has(k)) {
        missing++
        if (missingEx.length < 12) missingEx.push(`${rel}  MISSING instantiates ${k.split("|").slice(0, 2).join(" -> ")} (L${k.split("|")[2]})`)
      }
    }
    for (const k of truthKeys) if (published.has(k)) agree++
    tree.delete()
  }
  console.log(`files: ${files.length}`)
  for (const [k, v] of byClass) console.log(`  derived ${k}: ${v}`)
  console.log(`AGREE:   ${agree}`)
  console.log(`MISSING: ${missing}   <- a derivable instantiation the analyzer publishes no edge for`)
  console.log(`PHANTOM: ${phantom}   <- a published instantiation the tree does not derive`)
  console.log(`edges with NO line_number: ${noLine}`)
  for (const e of phantomEx) console.log("  " + e)
  for (const e of missingEx) console.log("  " + e)
  if (out) {
    fs.writeFileSync(out, JSON.stringify({
      files: files.length,
      derived: Object.fromEntries(byClass),
      totals: { agree, missing, phantom, noLine },
      knownLimit: "in-file targets only; qualified/external generic applications are unmeasured and need a cross-file type index",
      verdict: missing === 0 && phantom === 0 && noLine === 0 ? "clean" : "DEFECT",
    }, null, 2) + "\n")
    console.log(`\nwrote ${out}`)
  }
  process.exit(missing === 0 && phantom === 0 && noLine === 0 ? 0 : 1)
}
void main()
