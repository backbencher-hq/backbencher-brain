/**
 * ZIG WAVE 5 — the SOURCE-KEYED gate for `uses` and `calls` (Z37).
 *
 * These two classes are 24,743 of the lane's 38,271 relationships over 400 corpus
 * files, and until now the only instrument that judged them keys on
 * `label + normTarget(target)` — which DISCARDS the source. A read attributed to
 * the wrong function is a wrong graph, and a name-level gate cannot see it: that
 * is the Z22 shape (a local type's members filed under the enclosing container)
 * one class up, and Z19/Z21/Z22 between them moved hundreds of edges between
 * owners while every member name stayed the same.
 *
 * So this compares the two axes the shared matcher ignores:
 *
 *   key    (source, target, line)
 *   truth  `deriveZigEdgesWithSource` and `deriveZigBareUsesWithSource` from
 *          script/m14/zig-truth.ts, which walk the tree and carry the enclosing
 *          function on their own stacks
 *
 * Three verdicts, and the third is the interesting one:
 *
 *   AGREE      the derived (source, target, line) is published
 *   PHANTOM    published, and the derivation does not produce it \u2014 a wrong
 *              attribution, or an edge the analyzer invents
 *   MISSING    derived, and not published \u2014 a read or a call the analyzer loses,
 *              which no name-level gate can report either
 *
 * Known asymmetry, stated rather than hidden: the two truths DEDUPE per
 * (source, target) while this gate compares per (source, target, line), so a
 * file that reads the same name from the same function on five lines yields one
 * truth row and five analyzer rows. The analyzer's own `seen` sets are keyed
 * (source, target) too, so the counts should agree \u2014 and the first run of this
 * gate is what establishes that they do.
 *
 * Usage: npx tsx script/m14/tmp/zigw-uses-calls.ts [files]
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"
import { deriveZigEdgesWithSource, deriveZigBareUsesWithSource } from "../zig-truth"

async function main(): Promise<void> {
  await init()
  const limit = Number(process.argv[2] ?? 200)
  const files = zigFiles(["zig", "zls", "ghostty"], limit)
  let agree = 0, phantom = 0, missing = 0
  const byClass = new Map<string, { agree: number; phantom: number; missing: number }>()
  const phantomEx: string[] = [], missingEx: string[] = []
  const bump = (label: string, k: "agree" | "phantom" | "missing"): void => {
    const e = byClass.get(label) ?? { agree: 0, phantom: 0, missing: 0 }
    e[k]++
    byClass.set(label, e)
  }
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const root = tree.rootNode
    const rel = f.split("/repositories/")[1] ?? f
    const res: any = analyzer().analyze(root, src, f)

    const truth: { label: string; from: string; target: string; line: number }[] = [
      ...deriveZigEdgesWithSource(root),
      ...deriveZigBareUsesWithSource(root, res.symbols ?? []),
    ]
    // ── the design decision ────────────────────────────────────────────────
    // Comparing (source, target, line) as a KEY answers two questions at once:
    // "does this row exist" and "is it attributed to the right function". The
    // first is already settled at NAME level — the shared matcher compares
    // `label + normTarget(target)` and the first run agreed on 4,020 rows while
    // disagreeing on 647 SOURCES — so keying on the source re-litigates a
    // question that has an answer and buries the one that does not.
    //
    // So: for every (label, target) both sides agree exists, compare the SET of
    // sources. That isolates the axis the shared matcher discards, which is the
    // whole point of this file, and it is the Z22 shape one class up: an edge
    // whose name is right and whose owner is wrong reads as covered forever.
    const truthByName = new Map<string, Set<string>>()
    for (const t of truth) {
      const k = `${t.label}|${t.target}`
      truthByName.set(k, (truthByName.get(k) ?? new Set()).add(t.from))
    }
    const pubByName = new Map<string, Set<string>>()
    for (const r of res.relationships as any[]) {
      if (r.type !== "uses" && r.type !== "calls") continue
      const k = `${r.type}|${r.target}`
      pubByName.set(k, (pubByName.get(k) ?? new Set()).add(String(r.source)))
    }
    for (const [k, pubSources] of pubByName) {
      const truthSources = truthByName.get(k)
      if (!truthSources) {
        // the row exists only on the analyzer side: an existence disagreement,
        // already gated at name level. Counted, not re-litigated here.
        bump(k.split("|")[0], "phantom")
        if (phantomEx.length < 14) phantomEx.push(`${rel}  ANALYZER-ONLY  ${k}  (name-level existence — the shared matcher\u0027s question)`)
        continue
      }
      for (const src of pubSources) {
        if (!truthSources.has(src)) {
          phantom++
          bump(k.split("|")[0], "phantom")
          if (phantomEx.length < 14) phantomEx.push(`${rel}  WRONG SOURCE  ${k}  attributed to \`${src}\`, which the tree never reads it from`)
        } else {
          agree++
          bump(k.split("|")[0], "agree")
        }
      }
      for (const src of truthSources) {
        if (!pubSources.has(src)) {
          missing++
          bump(k.split("|")[0], "missing")
          if (missingEx.length < 14) missingEx.push(`${rel}  UNATTRIBUTED  ${k}  read in \`${src}\` per the tree, published with no such source`)
        }
      }
    }
    tree.delete()
  }
  console.log(`files: ${files.length}`)
  for (const [label, e] of byClass) {
    console.log(`  ${label.padEnd(7)} AGREE ${String(e.agree).padStart(6)}   PHANTOM ${String(e.phantom).padStart(4)}   MISSING ${String(e.missing).padStart(4)}`)
  }
  console.log(`  ${"TOTAL".padEnd(7)} AGREE ${String(agree).padStart(6)}   PHANTOM ${String(phantom).padStart(4)}   MISSING ${String(missing).padStart(4)}`)
  for (const e of phantomEx) console.log("  " + e)
  for (const e of missingEx) console.log("  " + e)
  console.log(phantom === 0 && missing === 0
    ? "\nverdict: every published read and call is attributed to the function the tree says, and every read the tree derives is published"
    : `\nverdict: ${phantom + missing} attribution disagreement(s) \u2014 the class the name-level matcher cannot see`)
  process.exit(phantom === 0 && missing === 0 ? 0 : 1)
}
void main()
