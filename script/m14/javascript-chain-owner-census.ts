/**
 * JAVASCRIPT CHAIN-SEGMENT OWNER CENSUS — which segments of a multi-segment member READ carry a
 * receiver type the file actually states.
 *
 * WHY THIS FILE EXISTS. `collectFieldAccessUses` used to flatten `w.a.b.c` into segments [a, b, c]
 * and take `cur`/`head` from the chain ROOT once, outside the segment loop — so every segment got
 * `owner=Widget`, though only `a`'s receiver IS the typed root. That was fixed (each segment now
 * carries its own receiver), and the fix's whole claim is a POPULATION claim: it removes the wrong
 * owners and removes no right ones. This instrument is how that claim is measured, and it is
 * committed so a reader re-runs it rather than trusting a number in prose.
 *
 * THE FALSIFIER IT ANSWERS. `this`-evidence fell by 943 rows on bootstrap. Two explanations have
 * opposite verdicts:
 *   (A) every drop is a segment at index >= 1 — the receiver there is not the typed root, so the
 *       owner was wrong. The fix is a pure correction.
 *   (B) some drop is a SINGLE-segment `this.x` — a receiver that genuinely is the typed root. Then
 *       the fix loses correct owners and must be narrowed.
 *
 * The measurement is by DEPTH, from the tree: depth 1 is the only depth the fix may change no answer
 * for; depth >= 2 is where it removes a row. `ownedAtDepth1` must be IDENTICAL before and after —
 * that identity is the falsifier's answer.
 *
 * It consults NEITHER the analyzer's field map NOR the store: depth is read from the grammar, so the
 * instrument cannot inherit the defect it measures (the shared-premise failure this lane records for
 * X1). The analyzer is consulted only for which rows it PUBLISHED, which is the question.
 *
 * READ-ONLY. Writes one artifact under validation/m14/tmp/.
 *
 *   bun run script/m14/javascript-chain-owner-census.ts --repo=<dir> [--sample=120] [--json=<out>]
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { ASTEngine, getParser } from "../../src/ast/engine"

const ROOT = process.cwd()
const SIZE_CAP = 512 * 1024

function argOf(flag: string): string | null {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(flag)
  if (i >= 0) return argv[i + 1] ?? null
  const hit = argv.find((a) => a.startsWith(flag + "="))
  return hit ? hit.slice(flag.length + 1) : null
}

const REPO = argOf("--repo") ?? "<corpus-root>/bb_tests/repositories/bootstrap"
if (!existsSync(REPO)) {
  console.error(`chain-owner-census: corpus not found at ${REPO} (pass --repo=<dir>)`)
  process.exit(2)
}
const SAMPLE = Number(argOf("--sample") ?? 120)
const JSON_OUT = argOf("--json")

/** `this.x` -> 1, `this.x.y` -> 2, `this.x.y.z` -> 3, not this-rooted -> 0. */
function thisDepth(n: any): number {
  let cur: any = n
  let depth = 0
  while (cur && cur.type === "member_expression") {
    depth++
    const obj = cur.childForFieldName("object")
    if (obj && obj.type === "this") return depth
    cur = obj
  }
  return 0
}

const tracked: string[] = execFileSync("git", ["-C", REPO, "ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
}).split("\0").filter(Boolean)

const admitted: string[] = []
for (const rel of tracked) {
  const abs = path.join(REPO, rel)
  try {
    if (statSync(abs).size > SIZE_CAP) continue
    if (detectLanguageFromPath(abs, readFileSync(abs, "utf8")) !== "javascript") continue
  } catch {
    continue
  }
  admitted.push(rel)
}
admitted.sort()
const stride = Math.max(1, Math.floor(admitted.length / SAMPLE))
const sample: string[] = []
for (let i = 0; i < admitted.length && sample.length < SAMPLE; i += stride) sample.push(admitted[i])

const parser = await getParser("javascript")

/** depth -> { tree: non-callee this-rooted member expressions, owned: rows the analyzer gave one } */
const byDepth = new Map<number, { tree: number; owned: number }>()
const bump = (d: number, field: "tree" | "owned"): void => {
  const row = byDepth.get(d) ?? { tree: 0, owned: 0 }
  row[field]++
  byDepth.set(d, row)
}

let cleanFiles = 0
for (const rel of sample) {
  let src: string
  try {
    src = readFileSync(path.join(REPO, rel), "utf8")
  } catch {
    continue
  }
  let root: any
  try {
    root = parser.parse(src)?.rootNode
  } catch {
    continue
  }
  if (!root || root.hasError) continue
  cleanFiles++

  // The `uses` walk's own input: non-callee member expressions. A callee is `calls`' business.
  // Keyed by (line, segment) so a published row can be matched back to the tree node it came from.
  const depthAt = new Map<string, number>()
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "member_expression") {
      const isCallee = n.parent?.type === "call_expression" &&
        n.parent.childForFieldName("function")?.id === n.id
      if (!isCallee) {
        const d = thisDepth(n)
        if (d > 0) {
          bump(d, "tree")
          const prop = n.childForFieldName("property")
          const key = `${n.startPosition.row + 1}|${prop?.text ?? ""}`
          // a depth-d chain also contains depth-(d-1) sub-chains at the same line; keep the deepest
          const prev = depthAt.get(key) ?? 0
          if (d > prev) depthAt.set(key, d)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }

  let res: any
  try {
    res = await ASTEngine.parseFile(path.join(REPO, rel), readFileSync(path.join(REPO, rel), "utf8"))
  } catch {
    continue
  }
  for (const r of res.relationships ?? []) {
    if (String(r.type) !== "uses") continue
    const md: any = r.metadata ?? {}
    if (md.isFieldAccess !== true) continue
    if (typeof md.owner !== "string" || md.owner.length === 0) continue
    const ln = r.line_number
    if (typeof ln !== "number") continue
    const d = depthAt.get(`${ln}|${String(r.target ?? "")}`)
    if (d !== undefined) bump(d, "owned")
  }
}

const depths = [...byDepth.keys()].sort((a, b) => a - b)
const total = (field: "tree" | "owned"): number =>
  [...byDepth.values()].reduce((acc, row) => acc + row[field], 0)

console.log(`chain-owner census — ${path.basename(REPO)}`)
console.log(`  admitted ${admitted.length}   sampled ${sample.length}   parsed clean ${cleanFiles}`)
console.log(`  this-rooted non-callee member expressions by depth:`)
for (const d of depths) {
  const row = byDepth.get(d)!
  console.log(`    depth ${d}:  tree ${String(row.tree).padStart(5)}   owned ${String(row.owned).padStart(5)}`)
}
console.log(`  totals: tree ${total("tree")}   owned ${total("owned")}`)
console.log(`\n  READ: depth 1 is the only depth the fix must leave unchanged;`)
console.log(`        depth >= 2 is where it removes an owner (the receiver there is not the typed root).`)

if (JSON_OUT) {
  mkdirSync(path.dirname(JSON_OUT), { recursive: true })
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        repo: REPO,
        admittedFiles: admitted.length,
        sampledFiles: sample.length,
        parseCleanFiles: cleanFiles,
        byDepth: Object.fromEntries(depths.map((d) => [d, byDepth.get(d)])),
        note:
          "Depth is read from the grammar, not from the analyzer's field map, so the instrument cannot inherit the defect it measures. 'tree' counts non-callee this-rooted member expressions; 'owned' counts the `uses` rows the analyzer published with metadata.owner at that depth. The fix may change 'owned' only at depth >= 2.",
      },
      null,
      2,
    ),
  )
  console.log(`  artifact: ${JSON_OUT}`)
}