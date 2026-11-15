/**
 * DOES PRODUCTION `parseFile` SURVIVE deep_nesting_statement_test.dart?
 *
 * ## The question
 *
 * `validation/m14/measurements/walk-dart.txt` marks two dart files `!bad`:
 *
 *     !/…/dart-sdk/tests/language/syntax/deep_nesting_statement_test.dart
 *     !/…/flutter-packages/packages/go_router/example/test/go_relative_test.dart
 *
 * `resumable-walk` marks bad on EITHER a throw OR a `[BB-HANG]` 120s guard, so the
 * marker alone does not say which happened, and the two cases want opposite answers:
 *
 *   - a THROW is a parser-robustness finding about the grammar;
 *   - a HANG is a cost finding about MY analyzer. `real-dart-analyzer.ts` walks the tree
 *     with an explicit `stack: Frame[]` (line 394) and is therefore iterative, so a
 *     120s guard trip cannot be recursion depth — it would be per-NODE cost, and that
 *     one WOULD be mine to fix.
 *
 * The depth probe already measured this file at 1,063 ms to parse, 43,567 nodes, depth
 * 20,005. 43,567 nodes cannot take 120 s in an iterative walker, so the prior
 * expectation is a THROW. Measured rather than assumed.
 *
 * ## The method
 *
 * One child per file, killed from OUTSIDE on a wall-clock budget. It cannot be done from
 * inside the child: `parser.parse()` is synchronous WASM on the main thread, so a timer
 * cannot preempt it — which is why `resumable-walk` exists and why the engine's own 120s
 * guard answers by calling `process.exit()`.
 *
 * The child ANNOUNCES the file and FLUSHES before parsing, so an instant kill still
 * leaves accurate blame on disk instead of degrading to "the walk died".
 *
 * A known-good CONTROL is always in the population. It earned its place: a first version
 * of this harness ran every file through `node --import tsx --input-type=module -e` and
 * all three exited 1 — including the control, which `parseFile` handles in 76 edges. A
 * harness that fails its own control measures the harness.
 *
 * Run: npx tsx validation/m14/fixtures/dart/parsefile-on-poison.ts [budgetMs]
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const budgetMs = Number(process.argv[2] ?? 180_000)
const CR = "/home/ishaq2321/bb_tests/repositories"

const bad = readFileSync(path.join(ROOT, "validation/m14/measurements/walk-dart.txt"), "utf8")
  .split("\n")
  .filter((l) => l.startsWith("!"))
  .map((l) => l.slice(1))
  .filter(Boolean)

const CONTROL = path.join(ROOT, "validation/m14/fixtures/dart/type-references.dart")
const files = [...bad, CONTROL]

/** The child, as a real file: `-e` with `--input-type=module` cannot load the engine. */
const CHILD_PATH = "/tmp/opencode/dart-poison-child.mts"
const ANNOUNCE = "/tmp/opencode/dart-poison-announce.txt"
mkdirSync("/tmp/opencode", { recursive: true })
writeFileSync(
  CHILD_PATH,
  `import { parseFile } from ${JSON.stringify(path.join(ROOT, "src/ast/pool-worker.ts"))}
import { appendFileSync } from "node:fs"
import * as path from "node:path"

const f = process.argv[2]
appendFileSync(process.env.BB_ANNOUNCE!, f + "\\n")
const t0 = Date.now()
try {
  const r: any = await parseFile(f, path.dirname(f))
  const rels = (r?.relationships ?? []).length
  const syms = (r?.symbols ?? []).length
  const byType: Record<string, number> = {}
  for (const x of (r?.relationships ?? [])) {
    const t = String(x?.type ?? "").toLowerCase()
    if (t) byType[t] = (byType[t] ?? 0) + 1
  }
  process.stdout.write("@@RESULT@@" + JSON.stringify({ ok: true, ms: Date.now() - t0, rels, syms, byType }))
} catch (e: any) {
  process.stdout.write("@@RESULT@@" + JSON.stringify({ ok: false, ms: Date.now() - t0, err: String(e?.message ?? e).slice(0, 500) }))
}
`,
)

console.log(`parseFile on the walk's bad files — external budget ${budgetMs} ms per file`)
console.log(`population: ${files.length} files, of which ${bad.length} are marked !bad and 1 is a known-good control\n`)

const rows: { label: string; verdict: string; detail: string }[] = []
for (const f of files) {
  if (!existsSync(f)) { console.log(`  MISSING  ${f}`); continue }
  const label = f.replace(`${CR}/`, "").replace(`${ROOT}/`, "")
  const r = spawnSync("npx", ["tsx", CHILD_PATH, f], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: budgetMs,
    env: { ...process.env, BB_ANNOUNCE: ANNOUNCE },
  })
  const raw = r.stdout ?? ""
  const i = raw.indexOf("@@RESULT@@")
  const parsed = i >= 0 ? safeParse(raw.slice(i + 10)) : null
  const timedOut = r.signal === "SIGTERM" || r.status === null
  const verdict = parsed
    ? parsed.ok ? `ok  (${parsed.ms} ms)` : `THREW (${parsed.ms} ms)`
    : timedOut ? `HUNG — no result within ${budgetMs} ms` : `DIED (status=${r.status} signal=${r.signal})`
  const detail = parsed
    ? parsed.ok ? `${parsed.rels} relationships, ${parsed.syms} symbols  ${JSON.stringify(parsed.byType)}`
                : String(parsed.err).split("\n")[0]
    : (r.stderr ?? "").trim().split("\n").filter((l) => l && !/^\s*at /.test(l)).slice(-2).join(" | ").slice(0, 300)
  rows.push({ label, verdict, detail })
  console.log(`  ${label}\n      -> ${verdict}\n      ${detail || "(no detail)"}`)
}

function safeParse(s: string): any {
  try { return JSON.parse(s.slice(0, s.lastIndexOf("}") + 1)) } catch { return null }
}

console.log(`
READING THIS TABLE
  ok      production parseFile handled the file; the !bad marker came from an earlier run
          or from the 120s guard on a colder path.
  THREW   the analyzer threw on it — a parser-robustness finding about the grammar,
          since this analyzer's tree walk is iterative (real-dart-analyzer.ts:394).
  HUNG    the analyzer hung. That is a COST finding and the only outcome that would put
          a defect inside src/ast/real-dart-analyzer.ts: 43,567 nodes at depth 20,005
          exceeding ${budgetMs} ms would be per-node cost.

CONTROL: type-references.dart must read ok. If it does not, this harness is broken and
         the other two rows mean nothing.`)

const control = rows.find((r) => r.label.includes("type-references.dart"))
if (control && !control.verdict.startsWith("ok")) {
  console.log(`\nHARNESS SELF-CHECK FAILED — control did not parse. Treat every row as void.`)
  process.exitCode = 1
}