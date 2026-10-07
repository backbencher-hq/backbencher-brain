/**
 * VUE ENUM DIVERGENCE — is every type this lane emits a value of `RelationshipType`?
 *
 * ## The question
 *
 * `src/ast/types.ts` declares ten members, and nine of them hold the ontology's
 * own word as the VALUE (`Calls = "calls"`, `Contains = "contains"`, …; several
 * have ALIAS keys — `PartOf`, `Composition`, `Dependency` — that share one
 * value, which is why a naive `Object.entries` walk over the enum collapses them
 * and prints an alias where a value was meant).
 *
 * `Imports = "brain_import"`. No key in the enum holds the value `"imports"`.
 * So `"imports"` — the string an analyzer writes when it emits an import edge —
 * is not a member value, and this lane's corpus carries thousands of rows
 * carrying it.
 *
 * ## Why this is worth a script
 *
 * The question "does this row's `type` name a member of the enum" has a precise
 * answer, and it is not the same question as "did the differential compare this
 * label". One answers whether the row is ADDRESSABLE; the other answers whether
 * it was CHECKED. Both matter, they are routinely conflated, and the first is
 * cheap and total while the second is scoped by whatever the shared harness
 * declares.
 *
 * ## What it measures, per emitted type
 *
 *   rows            how many the production path emitted, over the corpus
 *   inEnum          rows whose `type` string IS a value of `RelationshipType`
 *   notInEnum       rows whose `type` string is NOT
 *   enumKeysFor     every enum KEY that maps to the value those rows carry
 *
 * and then the consumer question, which is the one with teeth: how many DISTINCT
 * string literals appear in `type` at all, per ontology slot. A slot with two
 * literals cannot be filtered with one comparison.
 *
 * NO REGEX: enum membership is `Object.values(RelationshipType).includes(v)`;
 * slot assignment compares the lowercased literal against the ontology's ten
 * words by equality.
 *
 * USAGE  npx tsx script/m12/vue-enum-divergence.ts [out.json]
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"
import { RelationshipType } from "../../src/ast/types"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.argv[2] ?? "/tmp/vue-enum-divergence.json"
const LIMIT = Number(process.env.BB_VUE_LIMIT ?? "0")

const SLOTS_RAW = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const SLOTS = SLOTS_RAW

const enumValues = new Set<string>(Object.values(RelationshipType as unknown as Record<string, string>))
/** Every enum KEY that maps to `value`. Aliases included, and that is the point:
 *  `Contains` and `PartOf` are two keys for one value, so "which names does a
 *  consumer have to choose between" is a real question. */
const keysForValue = (value: string): string[] =>
  Object.entries(RelationshipType as unknown as Record<string, string>)
    .filter(([, v]) => v === value).map(([k]) => k)

const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked.sort()) {
    if (!rel.endsWith(".vue")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vue") continue
    files.push({ repo: e, dir, rel, abs })
  }
}
const drawn = LIMIT > 0 ? files.slice(0, LIMIT) : files
console.log(`vue enum divergence — ${drawn.length} corpus .vue files through parseFile\n`)
console.log(`RelationshipType members: ${Object.keys(RelationshipType).length} keys, ${enumValues.size} distinct values`)
console.log(`values: ${[...enumValues].sort().join(" ")}\n`)

type Slot = { rows: number; files: Set<string>; literals: Map<string, number>; notInEnum: Map<string, number> }
const slots = new Map<string, Slot>()
/**
 * Fetch-or-CREATE, and STORE. The first draft of this line was a bare
 * `slots.get(t) ?? { ... }` with no `slots.set`, which returns a fresh object for
 * an absent key and throws it away — so every row incremented a throwaway and
 * the script printed `0 rows, 0 divergences` over a 40-file draw on which
 * `parseFile` threw ZERO times. The symptom is indistinguishable from a clean
 * result, which is the failure mode a census exists to prevent. Kept as a
 * function so the store is impossible to forget at a second call site.
 */
function ensureSlot(t: string): Slot {
  const found = slots.get(t)
  if (found) return found
  const made: Slot = { rows: 0, files: new Set<string>(), literals: new Map<string, number>(), notInEnum: new Map<string, number>() }
  slots.set(t, made)
  return made
}
const get = ensureSlot

let otherLiterals = new Map<string, number>()
// Errors are COUNTED and the first few kept, never swallowed. An earlier draft
// of this file did `catch { continue }` and reported "0 rows, 0 divergences" for
// a 120-file draw while every `parseFile` was in fact throwing — which reads
// exactly like a clean result. An empty result over a non-empty corpus is a
// failure, and the only way to tell it from a finding is the error count.
const errs: string[] = []
let threw = 0
for (const f of drawn) {
  let res: any
  try { res = await parseFile(f.abs, f.dir) } catch (e: any) {
    threw++
    if (errs.length < 5) errs.push(`${f.repo}/${f.rel}: ${String(e?.message ?? e).slice(0, 120)}`)
    continue
  }
  const label = `${f.repo}/${f.rel}`
  for (const r of res.relationships ?? []) {
    const raw = r.type ?? r.relationshipType
    if (raw === undefined || raw === null) continue
    const lit = String(raw)
    const slot = lit.toLowerCase()
    const s = get(slot)
    s.rows++
    s.files.add(label)
    s.literals.set(lit, (s.literals.get(lit) ?? 0) + 1)
    if (!enumValues.has(lit)) s.notInEnum.set(lit, (s.notInEnum.get(lit) ?? 0) + 1)
    if (!SLOTS.includes(slot)) otherLiterals.set(lit, (otherLiterals.get(lit) ?? 0) + 1)
  }
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${pad("slot", 13)}${pad("rows", 9)}${pad("files", 8)}${pad("in enum", 9)}${pad("NOT in enum", 12)}literals seen`)
console.log("-".repeat(100))
const table: Record<string, unknown>[] = []
for (const t of SLOTS) {
  const s = slots.get(t)
  if (!s) { console.log(`${pad(t, 13)}0`); continue }
  const notIn = [...s.notInEnum.entries()].map(([k, v]) => `${k}=${v}`).join(" ")
  const lits = [...s.literals.entries()].map(([k, v]) => `${k}:${v}`).join(" ")
  console.log(`${pad(t, 13)}${pad(String(s.rows), 9)}${pad(String(s.files.size), 8)}${pad(String(s.rows - [...s.notInEnum.values()].reduce((a, b) => a + b, 0)), 9)}${pad(notIn || "-", 12)}${lits}`)
  table.push({
    slot: t, rows: s.rows, files: s.files.size,
    literals: Object.fromEntries(s.literals),
    notInEnum: Object.fromEntries(s.notInEnum),
    enumKeysForEachLiteral: Object.fromEntries([...s.literals.keys()].map((l) => [l, keysForValue(l)])),
  })
}
console.log("-".repeat(100))
console.log(`parseFile threw on ${threw} of ${drawn.length} files`)
for (const e of errs) console.log(`  ${e}`)
if (otherLiterals.size > 0) console.log(`literals outside the ten slots: ${[...otherLiterals.entries()].map(([k, v]) => `${k}:${v}`).join(" ")}`)
const diverge = table.filter((r) => Object.keys((r as any).notInEnum).length > 0)
console.log(`\nslots whose emitted literal is not a value of RelationshipType: ${diverge.length}`)
for (const d of diverge) console.log(`  ${(d as any).slot}: ${JSON.stringify((d as any).notInEnum)} — enum keys holding that value: ${JSON.stringify((d as any).enumKeysForEachLiteral)}`)

writeFileSync(OUT, JSON.stringify({
  corpusRoot: CR, files: drawn.length, parseFileThrew: threw, firstErrors: errs,
  enum: { keys: Object.keys(RelationshipType), values: [...enumValues] },
  table, literalsOutsideSlots: Object.fromEntries(otherLiterals),
}, null, 2))
console.log(`\nwrote ${OUT}`)