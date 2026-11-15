/**
 * PARSE ONE FILE, IN THIS PROCESS, AND REPORT WHETHER IT RETURNS.
 *
 * ## Why this is a separate process per file
 *
 * The whole point is to survive `process.exit()`. `parseFile` on a hanging input calls
 * `ASTEngine`'s 120s guard, which exits the PROCESS — so it cannot be probed from inside
 * the process doing the probing. One file per invocation, exit status as the signal:
 *
 *     0  returned normally        124  hit the external `timeout`, i.e. it hangs
 *     1  threw                    other  anything else
 *
 * The 124 is the observation that matters, and it is deliberately measured by an
 * EXTERNAL timer rather than by the engine's own 120s guard. The engine's guard is
 * what kills the gate; an external `timeout` is independent of it, so it can
 * distinguish "the engine's guard fired" from "the process was gone before the guard
 * could report". Those are different defects and only one of them is the gate's problem.
 *
 * Usage: parse-one.ts <file> [timeoutSeconds]
 */
import { parseFile } from "../../../../src/ast/pool-worker"
import * as path from "node:path"
import { statSync } from "node:fs"

const target = process.argv[2]
if (!target) {
  console.error("usage: parse-one.ts <file>")
  process.exit(2)
}
const dir = process.argv[3] ?? path.resolve(path.dirname(target), "..")

const t0 = Date.now()
try {
  const r: any = await parseFile(target, dir)
  const ms = Date.now() - t0
  let size = -1
  try {
    size = statSync(target).size
  } catch {}
  console.log(
    JSON.stringify({
      file: target,
      bytes: size,
      ok: true,
      ms,
      relationships: (r.relationships ?? []).length,
      symbols: (r.symbols ?? []).length,
    }),
  )
  process.exit(0)
} catch (e: any) {
  console.log(
    JSON.stringify({
      file: target,
      ok: false,
      ms: Date.now() - t0,
      error: String(e?.message ?? e).slice(0, 300),
    }),
  )
  process.exit(1)
}