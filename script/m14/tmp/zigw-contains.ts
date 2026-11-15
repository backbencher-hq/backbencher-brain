/**
 * ZIG WAVE 3 — the `contains` GATE, owner-sensitive and BIDIRECTIONAL.
 *
 * Why this file exists next to the F5 `contains` truth
 * (`deriveZigContainment` in script/m14/differential.ts):
 *
 *   1. The F5 matcher keys on `label + normTarget(target)`. The source is not
 *      part of the key, so F5 compares `contains` BY MEMBER NAME. It convicts a
 *      fabricated or missing edge whose NAME is wrong and is blind to one whose
 *      OWNER is wrong — and Z19 and Z21 each moved 335 edges to a different owner
 *      while keeping every member name. Here the key IS the owner.
 *   2. The ownership verifier (zigw-ownership.ts) is one-directional: it asks
 *      "is every PUBLISHED owner justifiable?" — which is how Z22 was found —
 *      and cannot ask "is a justifiable owner MISSING?". This file asks both.
 *
 * Four verdicts, and the exit code is the gate:
 *   AGREE       derived (owner, member) = published (owner, member)
 *   PHANTOM     published, and the tree does not derive that pair
 *   MISSING     derived, and the analyzer publishes no such pair
 *   COLLISION   two DISTINCT declarations under one (owner, name) — the store
 *               identity class, measured and FILED as #963, reported and NOT
 *               failed here, because the store's name-keyed owner lookup is the
 *               defect and no analyzer change can fix it
 *
 * Usage: npx tsx script/m14/tmp/zigw-contains.ts [files] [--out <path>]
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"
import { deriveZigContainment } from "../zig-truth"

const SEP = "\u0000"

async function main(): Promise<void> {
  await init()
  const args = process.argv.slice(2)
  const outIdx = args.indexOf("--out")
  const out = outIdx >= 0 ? args[outIdx + 1] : null
  const limitArg = args.find((a) => /^\d+$/.test(a))
  const limit = limitArg ? Number(limitArg) : 400
  const files = zigFiles(["zig", "zls", "ghostty"], limit)

  let agree = 0, phantom = 0, missing = 0, collision = 0
  const phantomEx: string[] = [], missingEx: string[] = [], collisionEx: string[] = []
  let pairs = 0

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const root = tree.rootNode
    const rel = f.split("/repositories/")[1] ?? f
    const res: any = analyzer().analyze(root, src, f)

    const derived = new Map<string, string>()
    for (const e of deriveZigContainment(root)) {
      pairs++
      derived.set(`${e.from}${SEP}${e.target}`, e.from)
    }
    const published = new Map<string, any[]>()
    for (const s of res.symbols as any[]) {
      if (!s.ownerName) continue
      const k = `${s.ownerName}${SEP}${s.name}`
      published.set(k, [...(published.get(k) ?? []), s])
    }
    for (const [k, list] of published) {
      if (list.length > 1) {
        collision++
        if (collisionEx.length < 10) {
          collisionEx.push(
            `${rel}  contains ${k.split(SEP)[0]} -> ${k.split(SEP)[1]}  published ${list.length}x at lines ` +
              list.map((s: any) => s.range?.startLine).join(","),
          )
        }
        continue
      }
      if (derived.has(k)) agree++
      else {
        phantom++
        if (phantomEx.length < 12) {
          phantomEx.push(`${rel}  PHANTOM contains ${k.split(SEP)[0]} -> ${k.split(SEP)[1]}  (${list[0].kind} at line ${list[0].range?.startLine})`)
        }
      }
    }
    for (const k of derived.keys()) {
      if (!published.has(k)) {
        missing++
        if (missingEx.length < 12) missingEx.push(`${rel}  MISSING contains ${k.split(SEP)[0]} -> ${k.split(SEP)[1]}`)
      }
    }
    tree.delete()
  }

  console.log(`files: ${files.length}  derived pairs: ${pairs}`)
  console.log(`AGREE:     ${agree}`)
  console.log(`PHANTOM:   ${phantom}   <- published, and the tree does not derive it`)
  console.log(`MISSING:   ${missing}   <- derived, and the analyzer does not publish it`)
  console.log(`COLLISION: ${collision}   <- #963, the store's name-keyed owner lookup (reported, not failed)`)
  if (phantomEx.length) {
    console.log("\n=== PHANTOM samples ===")
    for (const e of phantomEx) console.log("  " + e)
  }
  if (missingEx.length) {
    console.log("\n=== MISSING samples ===")
    for (const e of missingEx) console.log("  " + e)
  }
  if (collisionEx.length) {
    console.log("\n=== COLLISION samples (#963) ===")
    for (const e of collisionEx) console.log("  " + e)
  }
  if (out) {
    fs.writeFileSync(
      out,
      JSON.stringify(
        {
          files: files.length,
          derivedPairs: pairs,
          totals: { agree, phantom, missing, collision },
          verdict: phantom === 0 && missing === 0 ? "clean" : "DEFECT",
          phantomSamples: phantomEx,
          missingSamples: missingEx,
          collisionSamples: collisionEx,
        },
        null,
        2,
      ) + "\n",
    )
    console.log(`\nwrote ${out}`)
  }
  process.exit(phantom === 0 && missing === 0 ? 0 : 1)
}
void main()
