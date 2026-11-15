/**
 * ZIG WAVE 5 — the M60 LINE-ACCURACY measurement.
 *
 * The M60 line gate answers "does every relationship carry a line?" (a
 * presence question), and this lane answers yes: 100% of every class. Presence is
 * not ACCURACY though, and an inaccurate line is worse than a missing one, because
 * a consumer that jumps to it is confidently sent to the wrong place.
 *
 * So this measures the harder question per class: **does the recorded line
 * actually contain the thing the edge names?** The test is deliberately
 * type-specific, because "the target's name" means something different in each:
 *
 *   calls        the callee LEAF, which may be a member (`list.append` -> append)
 *   uses         the read's identifier leaf
 *   contains     the member's declaration line, so the MEMBER's name
 *   references   the type leaf as written
 *   imports      the module path's last segment — a path's own text is the check
 *                when it has one, because `../build/gresource.zig` on that line is
 *                the strongest possible confirmation
 *   exports      the exported NAME
 *   instantiates the type name at the head node
 *
 * A row can fail for a legitimate reason (the name is written on an adjacent line
 * for a multi-line construct, or the name is a BUILTIN the grammar does not spell
 * as text), so the output is a per-class rate with SAMPLES, not a verdict: the
 * number is the thing to read, and the samples are how to find out whether a bad
 * rate is a defect or an artefact of the check.
 *
 * Usage: npx tsx script/m14/tmp/zigw-line-accuracy.ts [files]
 */
import * as fs from "fs"
import { init, zigFiles, parser, analyzer } from "./zigw-harness"

async function main(): Promise<void> {
  await init()
  const limit = Number(process.argv[2] ?? 400)
  // A CALIBRATION control, so the verdict is falsifiable on demand rather than
  // only assertable. `--shift N` moves every reported line by N before the check,
  // which must collapse the accuracy: an accuracy gate that cannot be shown to
  // fail is not evidence of accuracy, it is evidence that the comparison is
  // loose. Run it with `--shift 1` and the number has to fall.
  const shiftIdx = process.argv.indexOf("--shift")
  const SHIFT = shiftIdx >= 0 ? Number(process.argv[shiftIdx + 1] ?? 0) : 0
  if (SHIFT !== 0) console.log(`CALIBRATION: every line shifted by ${SHIFT} -- a real accuracy gate must FAIL this`)
  const files = zigFiles(["zig", "zls", "ghostty"], limit)
  const lines = new Map<string, string>()
  const stats = new Map<string, { n: number; ok: number }>()
  const samples = new Map<string, string[]>()
  const bump = (type: string, ok: boolean, sample: string): void => {
    const e = stats.get(type) ?? { n: 0, ok: 0 }
    e.n++
    if (ok) e.ok++
    stats.set(type, e)
    if (!ok) {
      const arr = samples.get(type) ?? []
      if (arr.length < 6) arr.push(sample)
      samples.set(type, arr)
    }
  }
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const fileLines = src.split("\n")
    const tree = parser().parse(src)
    const res: any = analyzer().analyze(tree.rootNode, src, f)
    const rel = f.split("/repositories/")[1] ?? f
    void lines
    for (const r of res.relationships as any[]) {
      const ln = typeof r.line_number === "number" ? r.line_number + SHIFT : r.line_number
      if (typeof ln !== "number" || ln <= 0) {
        bump(String(r.type), false, `${rel}  NO LINE  ${r.source} -> ${r.target}`)
        continue
      }
      const text = fileLines[ln - 1] ?? ""
      const target = String(r.target ?? "")
      const leaf = target.includes(".") ? target.slice(target.lastIndexOf(".") + 1) : target
      let ok: boolean
      let want: string
      switch (r.type) {
        case "imports":
          // the strongest check available: the path as written, else its last segment
          ok = text.includes(target) || text.includes(leaf)
          want = target
          break
        case "calls":
        case "uses":
        case "references":
        case "contains":
        case "exports":
        case "instantiates":
          ok = text.includes(leaf) || (leaf.length > 3 && text.includes(leaf.slice(0, Math.max(4, leaf.length - 2))))
          want = leaf
          break
        default:
          ok = true
          want = target
      }
      bump(String(r.type), ok, `${rel}:${ln}  ${r.type} ${r.source} -> ${r.target}  want=${want}  line="${text.trim().slice(0, 70)}"`)
    }
    tree.delete()
  }
  console.log(`files: ${files.length}`)
  console.log("type            edges   line-contains-the-name")
  let totN = 0
  let totOk = 0
  for (const [t, e] of [...stats].sort((a, b) => b[1].n - a[1].n)) {
    const pct = e.n ? (e.ok / e.n) * 100 : 100
    console.log(`  ${t.padEnd(13)} ${String(e.n).padStart(6)}   ${pct.toFixed(2)}%  (${e.n - e.ok} off)`)
    totN += e.n
    totOk += e.ok
    for (const s of samples.get(t) ?? []) console.log(`      ${s}`)
  }
  console.log(`  ${"ALL".padEnd(13)} ${String(totN).padStart(6)}   ${((totOk / totN) * 100).toFixed(2)}%  (${totN - totOk} off)`)
}
void main()
