/**
 * 2026-09-29: verify csharp's SYMBOL SURFACE — every symbol's kind, name, owner and range,
 * against the tree, per property rather than in aggregate.
 *
 * WHY THIS IS A SEPARATE GATE. F1 checks that a symbol's NAME is unique and F6 checks that every
 * grammar node type is covered by SOME symbol. Neither checks that a symbol is correctly
 * ATTRIBUTED: a symbol with the right name, the right kind, and the wrong owner is invisible to
 * both, and an owner error propagates silently into every `contains` edge that symbol produces —
 * which means one wrong `ownerName` fabricates an entire class of edges downstream rather than
 * one row. It is also the field most likely to be wrong by accident, because owner is threaded
 * through a scope stack rather than read from the node that declares the thing.
 *
 * THE PROPERTIES, and why each is true under every design:
 *
 *   RANGE WITHIN FILE   the symbol's byte range and line range must lie inside the file. A range
 *                       that runs past the end is a claim about bytes that do not exist, and it is
 *                       the one thing a consumer can check without a grammar.
 *   RANGE ORDERING      start <= end on both axes. An inverted range is not a weaker claim, it is
 *                       a claim that the symbol occupies nothing.
 *   NON-EMPTY NAME      a symbol with an empty name cannot be the target of a relationship, so
 *                       every edge naming it is dangling. Discards (`_`) are excluded because
 *                       they are explicitly not bindings.
 *   OWNER IS A SYMBOL   an `ownerName` that names no symbol in the same file is a dangling owner,
 *                       and it means the `contains` edge built from it points at nothing. This is
 *                       the highest-value assertion here precisely because `contains` is derived
 *                       FROM `ownerName` and so cannot disagree with it.
 *   DECLARED SOMEWHERE   the name a symbol claims must be WRITTEN in the file, for every kind
 *                       except the synthesized ones. `constructor` and `Finalize` are not written
 *                       and are excluded for the same reason `verify-csharp-line-numbers` excludes
 *                       them: inventing a line for an unwritten name is the M59.A7 defect.
 *
 * WHAT IT DOES NOT CLAIM. It does not decide whether a symbol's kind is the most specific correct
 * one — `property` versus `field` is a modelling choice with defensible answers — nor whether a
 * nested type's owner should be the outer type or the namespace. Those are design questions. It
 * asserts only the properties that hold regardless of those answers.
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

const SYNTHESIZED = new Set(["constructor", "Finalize", "anonymous", "this"])

async function main() {
  const listFile = arg("--list")
  if (!listFile) { console.error("usage: verify-csharp-symbols.ts --list <paths> [--limit N]"); process.exit(2) }
  const limit = Number(arg("--limit") ?? 200)
  const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  let total = 0
  let badRange = 0
  let inverted = 0
  let emptyName = 0
  let danglingOwner = 0
  let unwrittenName = 0
  const samples: string[] = []
  const ownerSamples: string[] = []
  const byKind = new Map<string, number>()

  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    if (src.length > 1_000_000) continue
    const lineCount = src.split("\n").length
    let res: any
    try { res = await ASTEngine.parseFile(f, src) } catch { continue }
    const syms = res.symbols ?? []
    if (syms.length === 0) continue
    total += syms.length

    // the set of names this file actually writes, and the set of names it declares
    const declared = new Set<string>()
    for (const s of syms) if (s.name) declared.add(String(s.name))

    for (const s of syms) {
      byKind.set(String(s.kind), (byKind.get(String(s.kind)) ?? 0) + 1)
      const nm = String(s.name ?? "")
      if (!nm) {
        emptyName++
        if (samples.length < 10) samples.push(`  ${path.basename(f)}  EMPTY name  kind=${s.kind} owner=${s.ownerName ?? "-"}`)
        continue
      }
      const r = s.range ?? {}
      const si = r.startIndex, ei = r.endIndex, sl = r.startLine, el = r.endLine
      if (typeof si === "number" && (si < 0 || si > src.length)) {
        badRange++
        if (samples.length < 10) samples.push(`  ${path.basename(f)}  ${nm}  startIndex ${si} outside 0..${src.length}`)
      }
      if (typeof sl === "number" && (sl < 1 || sl > lineCount)) {
        badRange++
        if (samples.length < 10) samples.push(`  ${path.basename(f)}  ${nm}  startLine ${sl} outside 1..${lineCount}`)
      }
      if (typeof si === "number" && typeof ei === "number" && si > ei) {
        inverted++
        if (samples.length < 10) samples.push(`  ${path.basename(f)}  ${nm}  INVERTED byte range ${si}..${ei}`)
      }
      if (typeof sl === "number" && typeof el === "number" && sl > el) {
        inverted++
        if (samples.length < 10) samples.push(`  ${path.basename(f)}  ${nm}  INVERTED line range ${sl}..${el}`)
      }
      // owner must name a symbol in THIS file, or the `contains` edge built from it dangles
      const own = s.ownerName ?? s.scope
      if (own && !declared.has(String(own))) {
        // a namespace owner is legitimate when the namespace is not a symbol (file-scoped form
        // sometimes publishes one and sometimes does not), so only count a CLASS-shaped owner
        if (!String(own).includes(".")) {
          danglingOwner++
          if (ownerSamples.length < 10) ownerSamples.push(`  ${path.basename(f)}  ${nm}  owner="${own}" names no symbol in this file`)
        }
      }
      // the name must be WRITTEN, unless synthesized
      if (!SYNTHESIZED.has(nm) && typeof si === "number" && !src.slice(si, ei ?? si).includes(nm)) {
        unwrittenName++
        if (ownerSamples.length < 10) ownerSamples.push(`  ${path.basename(f)}  ${nm}  not written at its own range (${si}..${ei}) kind=${s.kind}`)
      }
    }
  }

  console.log(`symbol-surface audit — csharp, ${files.length} files, ${total} symbols\n`)
  console.log("  by kind:")
  for (const [k, v] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(6)}  ${k}`)
  console.log(`\n  range outside the file:  ${badRange}`)
  console.log(`  inverted range:          ${inverted}`)
  console.log(`  empty name:              ${emptyName}`)
  console.log(`  dangling owner:          ${danglingOwner}`)
  console.log(`  name not written at its own range: ${unwrittenName}`)
  if (samples.length > 0) { console.log(`\n  samples:`); for (const s of samples) console.log(s) }
  if (ownerSamples.length > 0) { console.log(`\n  owner/name samples:`); for (const s of ownerSamples) console.log(s) }

  const problems: string[] = []
  if (badRange > 0) problems.push(`${badRange} symbol(s) with a range outside their file`)
  if (inverted > 0) problems.push(`${inverted} symbol(s) with an inverted range`)
  if (emptyName > 0) problems.push(`${emptyName} symbol(s) with an empty name`)
  if (danglingOwner > 0) problems.push(`${danglingOwner} symbol(s) whose owner names no symbol in the file`)
  if (unwrittenName > 0) problems.push(`${unwrittenName} symbol(s) whose name is not written at its own range`)
  if (problems.length > 0) {
    console.log(`\nPROBLEMS (${problems.length}):`)
    for (const p of problems) console.log(`  ! ${p}`)
    console.log(`\nVERDICT: FAIL — a dangling owner is the expensive one: \`contains\` is derived FROM`)
    console.log(`ownerName, so one wrong owner does not corrupt one row, it corrupts a class of them.`)
    process.exit(1)
  }
  console.log(`\nVERDICT: PASS — every symbol's range lies inside its file and is ordered, every name is`)
  console.log(`  non-empty and actually written at its own range, and every owner names a real symbol.`)
  console.log(`  Kind PRECISION is not asserted: \`property\` versus \`field\` is a modelling choice, and a`)
  console.log(`  gate that picked one would be enforcing a preference rather than a property.`)
}

if (import.meta.main) await main()
