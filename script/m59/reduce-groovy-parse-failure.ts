// Delta-debug a groovy parse failure down to a MINIMAL failing source, so the
// next round works from a repro instead of a hunch about a file. The property
// is the tree's own `rootNode.hasError` — the same criterion the m12 census
// uses, never a hand-rolled ERROR-node walk (that walk false-positives on a
// zero-width EOF phantom; measured, see reviews/m49-w21).
//
// Two phases, both on line boundaries (a truncated block comment is itself an
// error, so cutting mid-token would manufacture a failure):
//   1. chunk removal — try to delete aligned blocks of decreasing size,
//      keeping the failure;
//   2. boundary trim — drop leading/trailing lines that are not needed.
// Nothing is claimed about WHY the reduced form fails: the failure is measured,
// the trigger is what a reader then has to explain.
//
// Usage: bun script/m14/tmp/g841-reduce.ts <file> [--max-lines N]
import * as fs from "fs"

async function main(): Promise<void> {
  const file = process.argv[2]
  const maxLines = process.argv.includes("--max-lines")
    ? parseInt(process.argv[process.argv.indexOf("--max-lines") + 1])
    : 400
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)

  const fails = (src: string): boolean => parser.parse(src)?.rootNode?.hasError === true

  const orig = fs.readFileSync(file, "utf8").split("\n")
  if (!fails(orig.join("\n"))) {
    console.log("the file PARSES CLEAN at this wasm — nothing to reduce")
    return
  }
  console.log(`original: ${orig.length} lines, fails`)

  let best = orig.slice()
  // Phase 1: aligned chunk removal, largest first.
  let gran = Math.max(1, Math.floor(best.length / 2))
  while (gran >= 1) {
    let i = 0
    let changed = false
    while (i < best.length) {
      const cand = best.slice(0, i).concat(best.slice(i + gran))
      if (cand.length > 0 && fails(cand.join("\n"))) {
        best = cand
        changed = true
      } else {
        i += gran
      }
    }
    if (!changed) gran = Math.floor(gran / 2)
  }
  // Phase 2: trim the boundaries.
  while (best.length > maxLines) {
    const cand = best.slice(1)
    if (fails(cand.join("\n"))) best = cand
    else break
  }
  const out = best.join("\n")
  console.log(`\nreduced to ${best.length} lines:`)
  console.log("-".repeat(60))
  console.log(out)
  console.log("-".repeat(60))
  const root = parser.parse(out)?.rootNode
  console.log(`fails=${root?.hasError} `)
  const stack: any[] = [root]
  let n = 0
  while (stack.length && n < 6) {
    const x = stack.shift()!
    if (x.type === "ERROR" || x.isMissing) {
      console.log(`${x.isMissing ? "MISSING" : "ERROR"} ${x.type} row ${x.startPosition.row + 1} :: ${JSON.stringify((x.text || "").slice(0, 120))}`)
      n++
    }
    for (let i = 0; i < x.childCount; i++) stack.push(x.child(i))
  }
  fs.writeFileSync("/tmp/g841-reduced.groovy", out + "\n")
  console.log(`written to /tmp/g841-reduced.groovy`)
}
main().catch((e) => { console.error(e); process.exit(1) })
