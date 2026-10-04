/**
 * FAIL if any `script/m14/<lang>-ruled.ts` exists but is NOT in RULED_BY_LANG.
 *
 * Why this needs to be a gate rather than a habit:
 *
 * A ruling table that exists on disk but is not registered is INVISIBLE. Nothing
 * errors. The arbiter simply reports that lane as having no ruling, the coverage
 * number silently drops, and the lane reads as "unadjudicated" — which is a
 * statement about the WORK rather than about a missing line in a map. That is the
 * worst direction for a silent failure: it makes a lane that did the harder work
 * look like a lane that skipped it.
 *
 * This exact loss happened twice in this programme:
 *   - php-ruled.ts and sql-ruled.ts were both committed and both unregistered while
 *     the arbiter reported 11 lanes. Found by counting files against the registry
 *     rather than trusting the registry's own count.
 *   - a merge that resolved the registry to ONE side rather than the union deleted
 *     seven entries silently, for the same reason.
 *
 * So the check is structural: the set of `*-ruled.ts` files on disk must EQUAL the
 * set of keys in RULED_BY_LANG. Either direction of difference fails, because an
 * entry pointing at a lane with no table is just as wrong as the reverse.
 *
 * Run: npx tsx script/m14/verify-ruling-tables-registered.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const GATE = join(HERE, "ontology-coverage-gate.ts")

const onDisk = new Set(
  readdirSync(HERE)
    .map((f) => /^([a-z0-9_+-]+)-ruled\.ts$/.exec(f)?.[1])
    .filter((x): x is string => !!x),
)

const src = readFileSync(GATE, "utf8")
const block = /const RULED_BY_LANG: Record<string, Ruled\[\]> = \{([\s\S]*?)\n\}/.exec(src)
if (!block) {
  console.error("could not locate RULED_BY_LANG — the gate's shape changed; update this check")
  process.exit(2)
}
const registered = new Set<string>()
for (const line of block[1].split("\n")) {
  const m = /^\s*([A-Za-z0-9_+-]+)\s*:/.exec(line)
  if (m) registered.add(m[1].toLowerCase())
}

const unregistered = [...onDisk].filter((l) => !registered.has(l)).sort()
const dangling = [...registered].filter((l) => !onDisk.has(l)).sort()

console.log(`ruling tables on disk : ${onDisk.size}  (${[...onDisk].sort().join(" ")})`)
console.log(`registered in arbiter : ${registered.size}  (${[...registered].sort().join(" ")})`)

if (unregistered.length === 0 && dangling.length === 0) {
  console.log("PASS — every ruling table on disk is registered, and every registration resolves")
  process.exit(0)
}
if (unregistered.length) {
  console.error(`\nUNREGISTERED (${unregistered.length}) — committed but invisible to the arbiter:`)
  for (const l of unregistered) console.error(`  script/m14/${l}-ruled.ts exists, RULED_BY_LANG.${l} does not`)
}
if (dangling.length) {
  console.error(`\nDANGLING (${dangling.length}) — registered but no table on disk:`)
  for (const l of dangling) console.error(`  RULED_BY_LANG.${l} has no script/m14/${l}-ruled.ts`)
}
console.error("\nAn unregistered ruling table does not fail loudly — it makes the lane read as")
console.error("unadjudicated. Register it, or delete it if the work was abandoned.")
process.exit(1)
