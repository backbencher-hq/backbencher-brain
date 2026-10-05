/**
 * TIME one file through PRODUCTION `parseFile`, in isolation.
 *
 * `script/m14/ontology-coverage-gate.ts` has a 120 s wall-clock guard and prints
 * `[BB-HANG] parser stuck 120s on <file>`. That line is not a measurement of the file: pass 8
 * of this lane established the method, and pass 11 needed it again. This tool is the other
 * half of the method — the arbiter names a file, this one says how long that file actually
 * takes with nothing else competing.
 *
 * The pass-11 population, three runs of the same gate on the same corpus, 2026-10-04:
 *
 *   run 1  scala3/scaladoc/.../layout/content.css   11,777 B   2,695 ms  1,446 errors
 *   run 2  grails-core/.../assets/stylesheets/errors.css  2,713 B  16,812 ms  0 errors
 *   run 3  scala3/scaladoc/.../layout/container.css     638 B   2,443 ms  5 errors
 *
 * Three different files, one per run, the two slowest still 7x inside the guard, and every
 * run carrying `[BB-PARSE-ERR] ... memory access out of bounds` on the file it then calls a
 * hang. The wasm heap failing to allocate and the wall clock running out are the same event:
 * the machine was at load 26-28 with 2 GB of 15 GB free and 88 concurrent `tsx` processes.
 * A corpus property does not move between runs; a memory condition does.
 *
 * Run: npx tsx validation/m14/tmp/css-time-one.ts <abs-path>
 * READ-ONLY. Writes nothing.
 */
/** TIME one file through production parseFile, in isolation. Pass 8's method: a hang
 *  population is measured, not argued. Prints elapsed ms and whether it degraded. */
import * as path from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"
const abs = process.argv[2]
const t0 = Date.now()
const r: any = await parseFile(abs, path.dirname(abs))
console.log(`${abs}\n  ${Date.now() - t0} ms  symbols=${(r?.symbols ?? []).length} relationships=${(r?.relationships ?? []).length} fallback=${r?.fallback === true} errors=${(r?.errors ?? []).length}`)
