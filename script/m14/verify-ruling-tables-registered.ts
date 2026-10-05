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

/**
 * Lanes this gate should expect to be ruleable at all.
 *
 * Kept as an explicit list rather than derived from the corpus, because the useful
 * question is not "does a file exist" but "is this lane adjudicated SOMEWHERE". A lane
 * with no `*-ruled.ts` is not necessarily unadjudicated — `rulingFor` also reads
 * `spec/<lang>-completeness.json`, and 11 lanes are ruled from there. So this gate
 * alone would have reported those 11 as gaps, which is the same over-reporting mistake
 * the arbiter's own guard was making.
 *
 * A lane appears on the UNADJUDICATED list when it has neither source. That list is the
 * real remaining work: every entry needs a lane to write a ruling table.
 */
const UNADJUDICATED = ["clean", "graphql", "r"]

const SPEC_DIR = join(HERE, "spec")

/**
 * Does this lane's spec supply any RULED decision?
 *
 * NOT "does the file exist" — that was the first version of this check and it was
 * wrong immediately: `clean-completeness.json` exists but carries no decision with
 * `status: "RULED"`, so the gate flagged its own UNADJUDICATED list as stale on the
 * run that added it. The question is whether the spec supplies a RULING, which is what
 * `rulingFor` actually looks for.
 */
function specSuppliesRuling(lang: string): boolean {
  const spec = join(SPEC_DIR, `${lang}-completeness.json`)
  if (!existsSync(spec)) return false
  try {
    const d = JSON.parse(readFileSync(spec, "utf8"))
    const decs = d?.design_decision?.decisions ?? []
    return decs.some((x: { status?: string }) => x?.status === "RULED")
  } catch {
    return false
  }
}

for (const lang of UNADJUDICATED) {
  if (specSuppliesRuling(lang)) {
    console.error(`STALE LIST: ${lang} is listed unadjudicated but its spec carries a RULED decision.`)
    console.error("Drop it from UNADJUDICATED. A stale list hides the lane it forgot.")
    process.exit(1)
  }
}

/** Any lane with neither source is a real gap and must be on the list, or the list lies. */
/**
 * Laptop B's lanes — the population this cross-check is over.
 *
 * Scoped deliberately. A first version globbed every spec in the directory and then
 * flagged `solidity`, which has no ruling source and is nobody's problem here: it is
 * another laptop's language. A gate that reports another team's backlog as your gap is
 * the same defect as measuring the wrong population — it is technically true and
 * practically useless, and it trains the reader to ignore the gate.
 *
 * So the population is stated, not inferred, and the gate only makes claims about it.
 */
const LANES_B = [
  // The authoritative 23 from docs/analyzers/PROMPT-LAPTOP-B.md.15, not a list I
  // reconstructed. My earlier list had 27 entries and was wrong in BOTH directions:
  //
  //   it included 6 lanes that are NOT laptop B's — groovy, haskell, java, python,
  //     ruby, scala — so this gate was making claims about other laptops' backlog;
  //   and it MISSED two of mine — graphql and markdown — which is why they had no
  //     agent and no ruling while lanes that are not mine were being measured.
  //
  // Six extra entries is the same defect as measuring the wrong population: each one
  // is a true statement about a language this laptop does not own, and together they
  // made the coverage number describe work nobody here is responsible for.
  //
  // Source of truth is the prompt, not this file. If the assignment changes, change
  // this list in the same commit — the gate below cross-checks it against the spec
  // directory, so a stale list fails loudly rather than drifting.
  "bash", "clean", "css", "dart", "fsharp", "graphql", "hcl", "json", "julia", "lua",
  "make", "markdown", "nim", "php", "powershell", "protobuf", "r", "scss", "sql",
  "toml", "xml", "yaml", "zig",
]

const missing = LANES_B.filter(
  (l) => !onDisk.has(l) && !specSuppliesRuling(l),
).sort()
const onList = new Set(UNADJUDICATED)
const unlisted = missing.filter((l) => !onList.has(l))
if (unlisted.length) {
  console.error(`INCOMPLETE LIST: these lanes have no table and no spec ruling, but are not`)
  console.error(`listed as unadjudicated: ${unlisted.join(" ")}`)
  console.error(`Add them, or the gate reports a clean state while work is outstanding.`)
  process.exit(1)
}

/**
 * The SAME check in the other direction — every lane LISTED as unadjudicated must
 * actually have no table and no spec ruling.
 *
 * This was missing, and the omission was not academic: it let this lane's own stale
 * entry survive. `scss` sat in UNADJUDICATED after `scss-ruled.ts` was written and
 * registered, so the gate printed
 *
 *     unadjudicated lanes (neither table nor spec RULED) : 4  (clean graphql r scss)
 *
 * while the arbiter, in the same repository, reported `implements RULED-SOUND` and
 * `instantiates RULED-SOUND` for scss off a 153-line table. Both statements were on
 * screen at once and the gate said PASS, because `unlisted` only walks
 * `missing -> UNADJUDICATED` and never `UNADJUDICATED -> missing`.
 *
 * The failure direction is the bad one: a lane that has DONE the adjudication keeps
 * being counted as backlog, so the remaining backlog is understated by however many
 * lanes finished — which is every lane that improves. That is a number that gets
 * worse as the programme succeeds, so it needs a check that fails when it drifts.
 */
const phantom = UNADJUDICATED.filter((l) => !missing.includes(l)).sort()
if (phantom.length) {
  console.error(`STALE LIST: these lanes are listed unadjudicated but now HAVE a ruling source:`)
  console.error(`${phantom.join(" ")}`)
  console.error(`Drop them from UNADJUDICATED. A lane that finished still counted as backlog`)
  console.error(`understates the backlog, and the understatement grows as lanes finish.`)
  process.exit(1)
}
console.log(`unadjudicated lanes (neither table nor spec RULED) : ${UNADJUDICATED.length}  (${UNADJUDICATED.join(" ")})`)
console.log(`cross-check: ${missing.length} lane(s) with no source, all listed — ${missing.join(" ") || "none"}`)

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
