/**
 * TREE-LIFETIME PROBE — is `parseThrew` a property of the FILE or of the PROCESS?
 *
 * ## The question
 *
 * `julia-scope-oracle-whole-corpus.json` records `closure.scanFailures.closure.parseThrew: 105`
 * with the message `Aborted(). Build with -sASSERTIONS for more info.` on every one. Two readings
 * are available and they have opposite consequences:
 *
 *   (a) 105 corpus files julia's grammar rejects. Then the closure arm is measuring a real
 *       language limitation and its ceiling is honest at 1,880 of 1,985.
 *   (b) 105 files the PROCESS could not parse by then. Then the closure arm's ceiling is a
 *       statement about when the harness ran out, not about julia, and it is published in a record
 *       that prints `admittedFiles: 1985`.
 *
 * The recorded evidence pointed at (b) without settling it: every example is in `julia/test/*.jl`,
 * the largest files in the corpus, and the run that produced them had already walked 600 files
 * through `parseFile` before the closure scan began.
 *
 * ## The instrument
 *
 * Parse every admitted file, repeatedly, in one process, and report which parses threw, after how
 * many parses, and at what RSS. Two arms, and **one process per arm**:
 *
 *   retain  parse and never free — the shape `scope-oracle.ts:scanFile` has today
 *   free    parse and `tree.delete()` immediately
 *
 * The first version of this probe ran both arms in ONE process and was void, which is worth
 * recording because the failure it produced looks like a result: `retain` threw on 1,928 files
 * with `Aborted()`, then `free` threw on 1,985 with a DIFFERENT message — `memory access out of
 * bounds` — and the honest reading of that pair is "the second arm inherited a corpse", not "freeing
 * is worse". A wasm trap leaves the module's linear memory unusable, so an arm that runs after a
 * trapping arm measures the first arm's damage. Each arm is therefore a separate child process, and
 * the parent compares the two child reports.
 *
 * ## What decides the question
 *
 *   - the SAME file failing in one arm and parsing in the other, or the same file parsing twice and
 *     failing on the third pass — the failure travels with the process, not the file;
 *   - RSS flat while failures climb — the exhaustion is inside the wasm module, not the host heap,
 *     so it will not show up as memory pressure and cannot be tuned away from outside.
 *
 * ## What this is not
 *
 * Not a parser-robustness census and not a claim about the grammar. It reads no node types. Its
 * only output is which parses threw, in which arm, after how many parses, at what RSS.
 *
 *     npx tsx validation/m14/fixtures/julia/tree-lifetime-probe.ts
 */

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX_BYTES = 512 * 1024
const PASSES = Number(process.env.BB_PROBE_PASSES ?? 3)

const rssMb = (): number => Math.round(process.memoryUsage().rss / 1e6)

/** The admitted list, discovered the way the gate and the census discover it. */
function admitted(): { abs: string; label: string }[] {
  const files: { abs: string; label: string }[] = []
  for (const e of readdirSync(CR)) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > MAX_BYTES) continue
        if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "julia") continue
      } catch { continue }
      files.push({ abs, label: `${e}/${rel}` })
    }
  }
  files.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  return files
}

interface ArmReport {
  arm: "retain" | "free"
  files: number
  passes: number
  perPass: { pass: number; parsed: number; threw: number; rssMb: number }[]
  totalParses: number
  threwFiles: string[]
  firstThrowAtParse: number | null
  firstMessage: string | null
  /** Files that threw in this arm AND in the other. Filled by the parent. */
  onlyHere?: string[]
}

/** One arm, in this process. Printed as a single JSON line prefixed with a sentinel. */
async function runArm(arm: "retain" | "free"): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default?.Language
  await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  // One parser, reused across every pass — the shape under test. A fresh parser per pass would
  // reset the very state the probe is trying to observe.
  const parser = new WSP()
  parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-julia.wasm"))))

  const files = admitted()
  const report: ArmReport = {
    arm,
    files: files.length,
    passes: PASSES,
    perPass: [],
    totalParses: 0,
    threwFiles: [],
    firstThrowAtParse: null,
    firstMessage: null,
  }
  const threw = new Set<string>()

  for (let pass = 1; pass <= PASSES; pass++) {
    let ok = 0
    let bad = 0
    for (const f of files) {
      let text: string
      try { text = readFileSync(f.abs, "utf8") } catch { continue }
      let tree: any
      report.totalParses++
      try {
        tree = parser.parse(text)
      } catch (err) {
        bad++
        if (report.firstThrowAtParse === null) report.firstThrowAtParse = report.totalParses
        if (report.firstMessage === null) report.firstMessage = (err as Error).message.slice(0, 120)
        threw.add(f.label)
        continue
      }
      if (!tree) { bad++; threw.add(f.label); continue }
      ok++
      if (arm === "free") tree.delete()
    }
    report.perPass.push({ pass, parsed: ok, threw: bad, rssMb: rssMb() })
  }
  report.threwFiles = [...threw].sort()
  process.stdout.write(`__ARM__${JSON.stringify(report)}\n`)
}

async function main(): Promise<void> {
  // `--arm` is the child entry point. The parent is the one that compares.
  const armArg = process.argv.find((a) => a.startsWith("--arm="))
  if (armArg) {
    const arm = armArg.slice("--arm=".length)
    if (arm !== "retain" && arm !== "free") {
      console.error(`unknown arm ${arm}`)
      process.exit(2)
    }
    await runArm(arm)
    return
  }

  const reports: ArmReport[] = []
  for (const arm of ["retain", "free"] as const) {
    process.stdout.write(`running arm ${arm} in its own process (${PASSES} passes)…\n`)
    // `process.argv[1]` rather than `__filename`: this fixture runs as ESM under tsx, where
    // `__filename` does not exist. The same expression the sibling fixtures use for their own root.
    const self = process.argv[1] ?? ""
    const out = execFileSync("npx", ["tsx", self, `--arm=${arm}`], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    })
    const line = out.split("\n").find((l) => l.startsWith("__ARM__"))
    if (!line) {
      console.error(`arm ${arm} produced no report; its process died`)
      process.exit(1)
    }
    reports.push(JSON.parse(line.slice("__ARM__".length)))
  }

  const [retain, free] = reports
  for (const r of reports) {
    console.log("")
    console.log(`arm ${r.arm}: ${r.files} admitted files, ${r.passes} passes, ${r.totalParses} parses`)
    for (const p of r.perPass) console.log(`  pass ${p.pass}: parsed ${p.parsed}, threw ${p.threw}, rss ${p.rssMb} MB`)
    console.log(`  first throw at cumulative parse ${r.firstThrowAtParse ?? "never"}`)
    console.log(`  files that threw at least once: ${r.threwFiles.length} of ${r.files}`)
    if (r.firstMessage) console.log(`  message: ${r.firstMessage}`)
  }

  const retainSet = new Set(retain.threwFiles)
  const freeSet = new Set(free.threwFiles)
  const onlyRetain = retain.threwFiles.filter((l) => !freeSet.has(l))
  const onlyFree = free.threwFiles.filter((l) => !retainSet.has(l))
  console.log("")
  console.log(`threw only with trees RETAINED: ${onlyRetain.length}`)
  for (const l of onlyRetain.slice(0, 8)) console.log(`   ${l}`)
  console.log(`threw only with the tree FREED:  ${onlyFree.length}`)
  for (const l of onlyFree.slice(0, 8)) console.log(`   ${l}`)

  // The two readings, and the observation that separates them.
  //
  // A file property would appear in BOTH arms and in the arm's FIRST pass. A process property
  // appears late in one arm and not at all in the other, and the arm that frees its trees is the
  // one that survives. Same-file disagreement between arms is the cleanest single discriminator,
  // so it is checked first and the "threw in pass 1" case is used only when the arms agree.
  const sameFiles = onlyRetain.length === 0 && onlyFree.length === 0
  const anyThrewInPassOne = reports.some((r) => (r.perPass[0]?.threw ?? 0) > 0)
  const fileProperty = sameFiles && anyThrewInPassOne
  console.log("")
  if (fileProperty) {
    console.log(`VERDICT: FILE property — the same ${retain.threwFiles.length} file(s) failed in both arms and in pass 1.`)
    console.log(`         A throw count is then a statement about those files and not about the harness.`)
  } else if (sameFiles) {
    console.log(`VERDICT: PROCESS property — the same ${retain.threwFiles.length} file(s) failed in both arms, but NONE of them`)
    console.log(`         failed in pass 1, so the failure arrives with the parse count, not with the file.`)
  } else {
    console.log(`VERDICT: PROCESS property — the arms disagree on ${onlyRetain.length + onlyFree.length} file(s), so a parse succeeds or`)
    console.log(`         fails depending on what the process did beforehand, not on which file it is.`)
  }
  const rssFlat = reports.some((r) => {
    const peak = Math.max(...r.perPass.map((p) => p.rssMb))
    const first = r.perPass[0]?.rssMb ?? peak
    return peak - first < 64 && (r.perPass[r.perPass.length - 1]?.threw ?? 0) > 0
  })
  if (rssFlat) {
    console.log(`         RSS stayed within 64 MB of its first pass while failures climbed, so the exhaustion is inside the`)
    console.log(`         wasm module's linear memory rather than the host heap — it will not appear as memory pressure.`)
  }
  process.exitCode = fileProperty ? 1 : 0
}

main().catch((e) => { console.error(e); process.exit(1) })
