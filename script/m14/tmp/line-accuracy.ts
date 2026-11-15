/**
 * M60 LINE VERIFICATION — a lane's M60 claim, checked by another lane.
 *
 * The M60 line contract has two halves and the second is the one that gets
 * skipped. "Does every relationship carry a line?" is a PRESENCE question, and it
 * is the easy one. "Does the line point at the thing the edge names?" is ACCURACY,
 * and an inaccurate line is worse than a missing one: a consumer that jumps to it
 * is confidently sent to the wrong place, and nothing in a presence-only census can
 * tell the difference.
 *
 * This probe is deliberately language-agnostic, because the question is not a zig
 * question: it is what anyone has to answer to say "M60 is done for this lane".
 * It reads the analyzer and grammar the same way the harness does, and it reports
 * four classes per relationship type, because they are four different bugs:
 *
 *   no line      absent, or zero/negative \u2014 a presence defect
 *   past EOF     present but beyond the file \u2014 a coordinate defect
 *   wrong        present, in range, and the line does not contain the name \u2014 the
 *                defect no presence census can see
 *   ok
 *
 * The name test is per type, because "the target's name" means different things:
 * a `calls`/`uses` target may be a member (`list.append` -> append), an
 * `imports`/`requires`/`exports` target is a path or a name as written, and a
 * `contains`/`extends`/`implements` target is a member or a base.
 *
 * CALIBRATION: a percentage from a new probe is worth nothing until the probe is
 * shown to convict, so the caller should run it with PERTURB=1, which shifts every
 * recorded line by +1 and must drive the wrong rate to ~0.
 *
 * Usage:
 *   npx tsx script/m14/tmp/line-accuracy.ts <lang> [corpusDirsCsv] [files] [PERTURB=1]
 *   npx tsx script/m14/tmp/line-accuracy.ts go go-tools,prometheus 400
 */
import * as fs from "fs"
import * as path from "path"

// The analyzer/grammar wiring is read from the harness's own LANGS table when it
// is available, and falls back to the two entries this probe was written for, so
// the probe stays runnable while that file is mid-repair by another lane.
const FALLBACK: Record<string, { analyzerFile: string; className: string; ext: string }> = {
  go: { analyzerFile: "real-go-analyzer", className: "RealGoAnalyzer", ext: "go" },
  zig: { analyzerFile: "real-zig-analyzer", className: "RealZigAnalyzer", ext: "zig" },
}

async function loadLang(lang: string): Promise<{ analyzer: any; cfg: any }> {
  let cfg: any = FALLBACK[lang]
  try {
    const mod: any = await import("../differential")
    if (mod.LANGS && mod.LANGS[lang]) cfg = { ...FALLBACK[lang], ...mod.LANGS[lang] }
  } catch {
    // the harness is unavailable or unparseable; the fallback stands
  }
  if (!cfg) throw new Error(`no analyzer wiring known for "${lang}"`)
  // through the PROJECT'S OWN loader, not a hand-rolled one: the registry knows
  // which grammars are pinned, and a second loader is a second thing to keep right
  await initWasm(lang)
  const mod: any = await import(`../../../src/ast/${cfg.analyzerFile}`)
  return { analyzer: new mod[cfg.className](), cfg }
}

let Parser: any = null
let Lang: any = null
/** The project's own loader, used the way the lane harnesses use it: `init()` on
 *  the Parser CLASS, then the pinned grammar bytes, then one parser instance with
 *  the language set. My first version skipped `init()` and every file threw — which
 *  is why the failure counter above exists. */
async function initWasm(lang: string): Promise<void> {
  if (Parser) return
  const { loadWebTreeSitter, hasWasmInRegistry } = await import("../../../src/util/wasm")
  const wts: any = await loadWebTreeSitter()
  const P: any = wts.Parser ?? wts.default?.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init()
  const bytes = hasWasmInRegistry(`tree-sitter-${lang}.wasm`)
  if (!bytes) throw new Error(`tree-sitter-${lang}.wasm is not in the project's wasm registry`)
  Lang = await L.load(bytes)
  Parser = P
}

function walkFiles(root: string, ext: string, limit: number): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length && out.length < limit) {
    const dir = stack.pop()!
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === ".git" || e.name === "vendor" || e.name === "testdata") continue
        stack.push(p)
      } else if (e.name.endsWith(`.${ext}`)) {
        out.push(p)
        if (out.length >= limit) break
      }
    }
  }
  return out.sort()
}

const PERTURB = process.argv.includes("PERTURB=1") || process.env.LINE_ACCURACY_PERTURB === "1"

async function main(): Promise<void> {
  const lang = process.argv[2] ?? "go"
  const dirs = (process.argv[3] ?? (lang === "go" ? "go-tools,prometheus" : "zig,zls,ghostty")).split(",")
  const limit = Number(process.argv[4] ?? 400)
  const corpusRoot = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
  const { analyzer, cfg } = await loadLang(lang)
  const files: string[] = []
  for (const d of dirs) files.push(...walkFiles(path.join(corpusRoot, d), cfg.ext, Math.ceil(limit / dirs.length)))
  const use = files.slice(0, limit)

  let failures = 0
  // `n` counts EVERY edge and each edge lands in exactly one of the four
  // buckets. The first version incremented `n` only on the OK path, so the
  // percentage was wrong/(ok) and the calibration run printed 1157% — which is
  // how a denominator bug announces itself if the number is read.
  const stats = new Map<string, { n: number; ok: number; noLine: number; pastEof: number; wrong: number }>()
  const samples = new Map<string, string[]>()
  const bump = (t: string, kind: keyof { noLine: number; pastEof: number; wrong: number } | "n", sample: string): void => {
    const e = stats.get(t) ?? { n: 0, ok: 0, noLine: 0, pastEof: 0, wrong: 0 }
    e[kind]++
    stats.set(t, e)
    // samples are for DEFECTS: printing ok-rows too made a clean run look noisy
    if (kind !== "n" && kind !== "ok") {
      const arr = samples.get(t) ?? []
      if (arr.length < 5) arr.push(sample)
      samples.set(t, arr)
    }
  }

  for (const f of use) {
    const src = fs.readFileSync(f, "utf8")
    const lines = src.split("\n")
    let tree: any = null
    try {
      const parser = new Parser()
      parser.setLanguage(Lang)
      tree = parser.parse(src)
      const res: any = analyzer.analyze(tree.rootNode, src, f)
      for (const r of res.relationships as any[]) {
        const t = String(r.type)
        const raw = typeof r.line_number === "number" ? r.line_number : (r.line ?? r.lineNumber)
        const ln = PERTURB && typeof raw === "number" ? raw + 1 : raw
        const target = String(r.target ?? "")
        const leaf = target.includes(".") ? target.slice(target.lastIndexOf(".") + 1) : target
        if (typeof ln !== "number" || !Number.isFinite(ln) || ln <= 0) {
          bump(t, "n", "")
        bump(t, "noLine", `${path.basename(f)}  ${t} -> ${target}  (line=${String(raw)})`)
          continue
        }
        if (ln > lines.length) {
          bump(t, "n", "")
          bump(t, "pastEof", `${path.basename(f)}  ${t} -> ${target} at L${ln} of ${lines.length}`)
          continue
        }
        const text = lines[ln - 1] ?? ""
        const ok = text.includes(target) || text.includes(leaf) || (leaf.length > 3 && text.includes(leaf.slice(0, Math.max(4, leaf.length - 2))))
        bump(t, "n", "")
        bump(t, ok ? "ok" : "wrong", `${path.basename(f)}:${ln}  ${t} ${r.source} -> ${target}  line="${text.trim().slice(0, 60)}"`)
      }
    } catch (e) {
      // A parse or analyze failure on one file must not end the census — but it
      // must be COUNTED, because a census that silently skips everything it could
      // not read reports 0 defects and means nothing. This probe reported 0 edges on
      // its first run for exactly that reason, and the fix was to make the skip
      // visible rather than to trust the number.
      failures++
      if (failures <= 3) console.log(`  SKIPPED ${path.basename(f)}: ${String((e as any)?.message ?? e).slice(0, 120)}`)
    } finally {
      if (tree && typeof tree.delete === "function") tree.delete()
    }
  }

  console.log(`lang=${lang}  files=${use.length}  files the probe could not read: ${failures}` + `  corpora=${dirs.join(",")}  ${PERTURB ? "PERTURBED (+1 on every line)" : "as published"}`)
  if (failures > 0) console.log("  A census that skipped files it could not read is not a clean run \u2014 the count above is the number to read.")
  void 0
  console.log(`lang=${lang}  files=${use.length}  corpora=${dirs.join(",")}  ${PERTURB ? "PERTURBED (+1 on every line)" : "as published"}`)
  console.log("type                edges     no line    past EOF       wrong   (of every edge, not of the survivors)")
  let n = 0, a = 0, b = 0, c = 0
  for (const [t, e] of [...stats].sort((x, y) => y[1].n - x[1].n)) {
    n += e.n; a += e.noLine; b += e.pastEof; c += e.wrong
    console.log(
      `  ${t.padEnd(16)} ${String(e.n).padStart(7)} ${String(e.noLine).padStart(9)} ${String(e.pastEof).padStart(10)} ${String(e.wrong).padStart(9)}   ${((e.wrong / Math.max(1, e.n)) * 100).toFixed(2)}% wrong`,
    )
    for (const s of samples.get(t) ?? []) console.log(`      ${s}`)
  }
  console.log(`  ${"TOTAL".padEnd(16)} ${String(n).padStart(7)} ${String(a).padStart(9)} ${String(b).padStart(10)} ${String(c).padStart(9)}   ${((c / Math.max(1, n)) * 100).toFixed(2)}%`)
  console.log(
    a + b + c === 0
      ? "\nverdict: every relationship carries a line, in range, and the line contains the name the edge names"
      : `\nverdict: ${a} with no line, ${b} past EOF, ${c} pointing at a line that does not contain the name`,
  )
}
void main()
