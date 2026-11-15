/**
 * CHILD of `trap-second-parse.ts` — one file, TWO parses, one process.
 *
 * Split into its own FILE, and not an `npx tsx -e` string, for a reason worth recording: this
 * repo's `package.json` declares `"type": "module"`, and `tsx` decides CJS-vs-ESM from the
 * nearest package.json to the FILE. A `-e` eval string, and a script written under `/tmp`, are
 * both outside that boundary and are transformed as CJS — where the top-level `await parseFile(...)`
 * is a hard error (`ERR_REQUIRE_ASYNC_MODULE`), and the child dies before printing a single line.
 * That is what the first run of the parent did, and it produced a clean "0 of 2 paired" reading
 * from two processes that never ran. A negative result from a process that did not start is not
 * a measurement, and the parent now says so rather than reporting it.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/trap-second-parse-child.ts <file.zig>
 * Prints one `attempt N  <ms>ms  <outcome>` line per parse. If the engine's 120 s guard fires
 * (`process.exit(1)` in `src/ast/engine.ts:1442`) the process ends mid-run, which is itself the
 * observation: the guard names the file whose `parser.parse()` blocked.
 */
import path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const file = process.argv[2]
if (!file) {
  process.stderr.write("usage: trap-second-parse-child.ts <file.zig>\n")
  process.exit(64)
}
const dir = path.dirname(file)

for (let attempt = 1; attempt <= 2; attempt++) {
  const t0 = Date.now()
  let outcome: string
  try {
    const r: any = await parseFile(file, dir)
    outcome =
      `ok symbols=${r?.symbols?.length ?? -1} rels=${r?.relationships?.length ?? -1}` +
      ` fallback=${r?.fallback === true}`
  } catch (e: any) {
    outcome = "THREW " + String(e?.message ?? e).slice(0, 140)
  }
  // stdout, unbuffered through the parent: the parent reads this line to decide a parse RETURNED.
  process.stdout.write(`attempt ${attempt}  ${Date.now() - t0}ms  ${outcome}\n`)
}