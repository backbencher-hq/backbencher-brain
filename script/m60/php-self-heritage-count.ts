/**
 * php — how many heritage edges name the declaration they start from?
 *
 *   bun script/m60/php-self-heritage-count.ts [--files N]
 *
 * ## Why a population counter beside the fixture
 *
 * `validation/m14/fixtures/php/enum-self-heritage.php` pins the SHAPE and
 * `script/m14/php-mutants.ts`'s two self-heritage mutants keep the pin able to fail. Neither can say
 * how often the shape occurs in real code, and the number matters in the direction that decides
 * whether the fix was worth its risk: removing an edge is differential-visible, so the case for
 * removing these is not "they are ugly" but "this many edges asserted a parent that cannot exist".
 *
 * The admission rule is `store-resolution-census.mts`'s, deliberately — same corpus root, same
 * `git ls-files` enumeration, same path-first language routing with content read only for
 * extensionless files, same size cap — because two instruments reporting on the same lane with two
 * different populations cannot be compared and nothing would say so. The FRAME is a deterministic
 * stride for the same reason the census uses one.
 *
 * A heritage edge is self-referencing when `source === target`, which is a property of the stored
 * rows rather than of the rule that produced them: this counts edges, it does not re-derive the
 * clause. `metadata.superTypes` is counted separately because the same defect had a second carrier —
 * a declaration listed in its OWN heritage, which a consumer walking the column would follow.
 *
 * READ-ONLY: it parses files and counts. It stores nothing and writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const args = process.argv.slice(2)
const argOf = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const N = Number(argOf("--files") ?? 600)
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const SIZE_CAP = 512 * 1024
/** The kinds that can carry a heritage: the same set the analyzer's own class-like test uses. */
const CLASS_LIKE = new Set(["class", "interface", "enum"])
const HERITAGE_EDGES = new Set(["extends", "implements"])

const admitted: { label: string; abs: string }[] = []
let reposScanned = 0
for (const entry of readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, entry)
  let tracked: string[] = []
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    reposScanned++
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    const base = path.basename(abs).toLowerCase()
    const needsContent = base.lastIndexOf(".") < 0
    let text: string | undefined
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      if (needsContent) text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "php") continue
    admitted.push({ label: `${entry}/${rel}`, abs })
  }
}
admitted.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
const population = admitted.length
const frame: typeof admitted = []
if (N === 0 || population <= N) frame.push(...admitted)
else for (let i = 0; i < N; i++) frame.push(admitted[Math.floor((i * population) / N)])
const frameDigest = createHash("sha256").update(frame.map((f) => f.label).join("\n")).digest("hex").slice(0, 16)

console.log("php self-heritage count — heritage edges that name their own source")
console.log(`corpus root         ${CORPUS}`)
console.log(`repos scanned       ${reposScanned}`)
console.log(`admitted population ${population}`)
console.log(
  `files in frame      ${frame.length}` +
    (frame.length < population ? `   SAMPLE of ${population} (--files ${N}) — a rate, not a total` : "   (the whole admitted population)"),
)
console.log(`frame digest        ${frameDigest}`)

let parseErrors = 0
let edges = 0
let selfEdges = 0
const selfByType: Record<string, number> = {}
const selfCarriers: string[] = []
let heritageEdges = 0
let selfSuperTypes = 0
for (const f of frame) {
  let r: any
  try {
    r = await parseFile(f.abs, "php")
  } catch {
    parseErrors++
    continue
  }
  if (r?.errors?.length) parseErrors++
  for (const x of r?.relationships ?? []) {
    const t = String(x?.type ?? "")
    if (!HERITAGE_EDGES.has(t)) continue
    heritageEdges++
    const src = String(x?.source ?? "")
    const tgt = String(x?.target ?? "")
    if (!src || !tgt || src === tgt) {
      if (src === tgt && src) {
        selfEdges++
        selfByType[t] = (selfByType[t] ?? 0) + 1
        if (selfCarriers.length < 12) selfCarriers.push(`${f.label}: ${t} ${src} -> ${tgt}`)
      }
      // A heritage edge with an EMPTY endpoint is a different defect and is not counted here.
      continue
    }
    edges++
  }
  for (const s of r?.symbols ?? []) {
    if (!CLASS_LIKE.has(String(s?.kind))) continue
    const list = (s?.metadata as any)?.superTypes
    if (!Array.isArray(list) || list.length === 0) continue
    if (list.some((n: any) => String(n) === String(s.name))) {
      selfSuperTypes++
      if (selfCarriers.length < 12) selfCarriers.push(`${f.label}: superTypes of ${s.name} lists itself`)
    }
  }
}

console.log(`\nparse errors        ${parseErrors}`)
console.log(`heritage edges      ${heritageEdges}  (extends + implements)`)
console.log(`  non-self          ${edges}`)
console.log(`  SELF-REFERENCING  ${selfEdges}${Object.keys(selfByType).length ? `   by type: ${JSON.stringify(selfByType)}` : ""}`)
console.log(`symbols whose superTypes lists THEMSELVES  ${selfSuperTypes}`)
if (selfCarriers.length) {
  console.log("\nexamples:")
  for (const c of selfCarriers) console.log(`  ${c}`)
}
console.log(
  selfEdges === 0 && selfSuperTypes === 0
    ? "\nverdict: CLEAN — no heritage edge names its own source, and no symbol lists itself in its heritage"
    : "\nverdict: SELF-HERITAGE PRESENT — see the rows above",
)
process.exitCode = selfEdges === 0 && selfSuperTypes === 0 ? 0 : 1
