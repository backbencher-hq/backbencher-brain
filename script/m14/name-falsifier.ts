/**
 * THE RUN FALSIFIER FOR "THE PROJECT DECLARES THIS NAME NOWHERE" — task-169.
 *
 * WHY THIS EXISTS. Three lanes classified their residual independently today (java `nothingAnywhere`
 * 64%, julia `declared-nowhere` 55%, powershell `noDecl` 70,694) and all three landed NO FIX for the
 * same reason: a name the project declares nowhere has no declaration to resolve to, so "resolving"
 * it means choosing one the evidence says does not exist. Clause 1's first arm is therefore
 * UNREACHABLE for roughly 60% of the fleet's residual BY CONSTRUCTION, and clause 1's second arm —
 * "or carries a claim the project verifies" — is the only path. That path is a clause-3 ruling, and
 * the bar requires a ruling to carry a RUN FALSIFIER.
 *
 * WHAT A FALSIFIER HAS TO BE. A run that would have FAILED had the ruling been wrong. For this
 * cause the ruling is "the population declares this name NOWHERE", so the falsifier is a search that
 * returns ZERO — and THE ZERO IS ONLY EVIDENCE IF THE SAME SEARCH CAN RETURN NON-ZERO. Hence the two
 * controls below, which run on EVERY invocation and exit 3 if either stops behaving. This programme
 * produced five checks in one session that could not fail; a search returning zero for everything
 * certifies every claim and falsifies nothing, and it is exactly that shape.
 *
 * WHAT IT IS NOT. A ruling moves a cause from `unresolved` to RULED-WITH-EVIDENCE. It does not
 * resolve anything and this tool never reports a resolution. An edge whose name IS found here is
 * NOT rulable — it belongs to a fixable class, and the tool says so rather than folding it in.
 *
 * RUN: bun run script/m14/name-falsifier.ts --lang julia --names throw,isa,length
 *      bun run script/m14/name-falsifier.ts --lang julia --names-file <one name per line>
 * EXIT: 0 = ran, controls fired, verdicts printed · 3 = A CONTROL DID NOT FIRE, verdicts refused.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const SENTINEL = "bbSentinelDeclaredNowhere_9f3a1c7e"

/** Per-language declaration shapes. A shape here is a way the language DECLARES a name; a mention is
 *  not a declaration, which is why `using`/`import`/`export` are absent — they name something
 *  declared elsewhere, and treating them as declarations is how a stdlib name would look declared. */
const SHAPES: Record<string, (n: string) => RegExp[]> = {
  julia: (n) => [
    new RegExp(`^\\s*(?:mutable\\s+)?struct\\s+${n}\\b`),
    new RegExp(`^\\s*(?:abstract|primitive)\\s+type\\s+${n}\\b`),
    new RegExp(`^\\s*module\\s+${n}\\b`),
    new RegExp(`^\\s*macro\\s+${n}\\b`),
    new RegExp(`^\\s*function\\s+${n}\\b`),
    new RegExp(`^\\s*${n}\\s*\\([^)]*\\)\\s*(?:where\\b|::|=)`), // f(x) = …  /  f(x)::T where …
    new RegExp(`^\\s*(?:const\\s+)?${n}\\s*(?:::[^=]+)?=`), // x = …  /  const x = …
    new RegExp(`^\\s*@(?:enum|kwdef)\\b[^\\n]*\\b${n}\\b`), // macro-generated declarations
  ],
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function walk(dir: string, ext: string, out: string[]): void {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries) {
    if (e === ".git" || e === "node_modules") continue
    const p = path.join(dir, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, ext, out)
    else if (e.endsWith(ext) && st.size <= 512 * 1024) out.push(p)
  }
}

/** The whole-population search: how many FILES declare `name`, and where. */
function search(files: string[], lang: string, name: string): { files: string[]; lines: number } {
  const last = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name
  const bare = last.replace(/[!?]$/, "") // julia's `push!` declares as `push!`; match both spellings
  const pats = SHAPES[lang]!(esc(bare))
  const hit: string[] = []
  let lines = 0
  for (const f of files) {
    let text: string
    try { text = readFileSync(f, "utf8") } catch { continue }
    let n = 0
    for (const line of text.split("\n")) if (pats.some((p) => p.test(line))) n++
    if (n > 0) { hit.push(f); lines += n }
  }
  return { files: hit, lines }
}

const argv = process.argv.slice(2)
const arg = (k: string): string | undefined => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined)
const LANG = arg("--lang") ?? "julia"
const EXT = arg("--ext") ?? (LANG === "julia" ? ".jl" : `.${LANG}`)
const NAMES = (() => {
  const inline = arg("--names")
  if (inline) return inline.split(",").map((s) => s.trim()).filter(Boolean)
  const file = arg("--names-file")
  if (file && existsSync(file)) return readFileSync(file, "utf8").split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"))
  return []
})()

const files: string[] = []
walk(CR, EXT, files)
files.sort()
console.log(`name-falsifier — ${LANG}, whole admitted population: ${files.length} ${EXT} file(s) under ${CR}`)
console.log(`declaration shapes searched: ${SHAPES[LANG] ? SHAPES[LANG]("NAME").length : 0}`)
if (files.length === 0 || NAMES.length === 0) {
  console.error("REFUSING: no files or no names — a search over nothing returns zero for everything, which is the failure this tool exists to prevent.")
  process.exit(3)
}

// ─── THE CONTROLS. Both run on EVERY invocation; either failing refuses every verdict below. ───────
const controlFailures: string[] = []
// CONTROL 1 (POSITIVE, and self-calibrating): a name the scan itself finds declared must be FOUND by
// the same search. Without this, a broken scan returns zero for everything and certifies the class.
let declaredSample: string | null = null
outer: for (const f of files) {
  let text: string
  try { text = readFileSync(f, "utf8") } catch { continue }
  for (const line of text.split("\n")) {
    const m = /^\s*(?:mutable\s+)?struct\s+([A-Za-z_][A-Za-z0-9_!]*)/.exec(line) ?? /^\s*function\s+([A-Za-z_][A-Za-z0-9_!]*)/.exec(line)
    if (m && m[1] && !NAMES.includes(m[1])) { declaredSample = m[1]; break outer }
  }
}
if (declaredSample === null) controlFailures.push("POSITIVE control: the scan found NO declaration anywhere in the population, so it cannot find one anywhere either — every zero below would be meaningless")
else {
  const c = search(files, LANG, declaredSample)
  if (c.files.length === 0) controlFailures.push(`POSITIVE control FAILED: '${declaredSample}' is declared in the population but the search found it in 0 files — a search that finds nothing certifies every 'declared nowhere' claim it is given`)
  else console.log(`CONTROL 1 (positive, must FIND): '${declaredSample}' declared in ${c.files.length} file(s) — the search CAN return non-zero. FIRED.`)
}
// CONTROL 2 (SENTINEL): a name that cannot exist must return zero. This is the arm that would catch a
// shape so loose it matches every line — the failure mode opposite to control 1's.
{
  const c = search(files, LANG, SENTINEL)
  if (c.files.length !== 0) controlFailures.push(`SENTINEL control FAILED: '${SENTINEL}' cannot exist but was 'found' in ${c.files.length} file(s) — the search matches things that are not declarations`)
  else console.log(`CONTROL 2 (sentinel, must find NOTHING): '${SENTINEL}' found in 0 file(s). FIRED.`)
}
if (controlFailures.length > 0) {
  console.error("\nFATAL: a control did not fire. A falsifier whose control cannot fail is not a falsifier.")
  for (const f of controlFailures) console.error(`  ${f}`)
  console.error("REFUSING to print a single verdict: this is the shape of the five unfalsifiable checks.")
  process.exit(3)
}

// ─── THE VERDICTS ─────────────────────────────────────────────────────────────────────────────────
console.log(`\nname                              files  lines  verdict`)
let rulable = 0
for (const n of NAMES) {
  const r = search(files, LANG, n)
  const v = r.files.length === 0
    ? "RULABLE — declared NOWHERE in the population"
    : `NOT RULABLE — declared in ${r.files.length} file(s); this is a FIXABLE class, not this one`
  if (r.files.length === 0) rulable++
  console.log(`${n.padEnd(33)} ${String(r.files.length).padStart(5)}  ${String(r.lines).padStart(5)}  ${v}`)
  for (const f of r.files.slice(0, 3)) console.log(`      found: ${path.relative(CR, f)}`)
}
console.log(`\n${rulable} of ${NAMES.length} name(s) are RULABLE by this falsifier (declared nowhere in the population);`)
console.log(`${NAMES.length - rulable} were FOUND and are NOT this class — they stay unresolved and belong to a fixable bucket.`)
console.log(`A rule here is a RULING, not a resolution: the edges stay counted.`)
