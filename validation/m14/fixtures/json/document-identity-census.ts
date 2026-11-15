/**
 * DOCUMENT-DECLARED IDENTITY CENSUS — how many `$ref`s in the admitted json population name a
 * base URI / anchor that THEIR OWN DOCUMENT declares with `$id` / `$anchor`?
 *
 * ## Why this exists
 *
 * The lane's residual classification (`validation/m14/verification/JSON-FIX.md` §1) names one
 * doable `ext?` cause: a `$ref` written as `/api/v31/components/schemas/petdetails` (or with a
 * `#anchor` fragment) is published VERBATIM and marked `isExternal`, while the admitting document
 * declares that exact identity in an `$id` / `$anchor` pair one object away. The gate measured 4
 * such edges on `--repo=gql-graphql-mesh`. This census asks the wider question the classification
 * must answer: **is the class 4 edges, or is the 4 only what one repository shows?**
 *
 * ## What it measures
 *
 * For every admitted json-family file under the corpus root (the router's own extension set, the
 * same spelling the gate admits), it reads `$id`, `$anchor` and `$ref` STRING VALUES out of the
 * document and answers, per file:
 *
 *   - does any `$ref` equal an `$id` declared in the same document?                (base identity)
 *   - does any `$ref` = <declared $id base>#<declared $anchor>?                    (anchored identity)
 *   - what is the `$ref` a fragment JSON-Pointer (`#/...`)? Those are a DIFFERENT, already
 *     handled class (`referenceTarget` resolves them) and are reported separately.
 *
 * It is a TEXT scan on purpose and it is NOT the proof of resolution: it sizes the population so
 * the analyzer fix can be measured against a whole-corpus count instead of one repo's four edges.
 * The resolution proof is the incoming gate before/after (`--repo=gql-graphql-mesh`).
 *
 * ## No mutation
 *
 * Read-only walk. Writes nothing.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/json/document-identity-census.ts [--root <corpusRoot>] [--max-bytes 1048576]
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const argv = process.argv.slice(2)
const argOf = (flag: string, fallback: string): string => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const ROOT = argOf("--root", process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories")
const MAX_BYTES = Number(argOf("--max-bytes", "1048576"))
const EXTS = [".json", ".jsonc", ".jsonl", ".jsonlog"]

interface Hit {
  repo: string
  rel: string
  line: number
  ref: string
  kind: "base-identity" | "anchored-identity" | "pointer-fragment"
  declaredAt: string
}

const hits: Hit[] = []
let filesScanned = 0
let filesWithId = 0
let overCap = 0

/** 1-based line of a character offset. */
function lineOf(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/** All string values for one key, with the offset of the value's opening quote. */
function valuesOf(text: string, key: string): { value: string; offset: number }[] {
  const out: { value: string; offset: number }[] = []
  const needle = `"${key}"`
  let from = 0
  for (;;) {
    const at = text.indexOf(needle, from)
    if (at < 0) break
    from = at + needle.length
    let i = from
    while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\r" || text[i] === "\n")) i++
    if (text[i] !== ":") continue
    i++
    while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\r" || text[i] === "\n")) i++
    if (text[i] !== '"') continue
    const start = i
    i++
    let value = ""
    let closed = false
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === "\\") { value += text[i + 1] ?? ""; i++; continue }
      if (c === '"') { closed = true; break }
      value += c
    }
    if (closed) out.push({ value, offset: start })
  }
  return out
}

/** Strip ONE trailing empty fragment — `$id` and `$ref` may spell the same base with or without `#`. */
const baseOf = (uri: string): string => (uri.endsWith("#") ? uri.slice(0, -1) : uri)

function walk(dir: string, repo: string, rel: string): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries.sort()) {
    if (name === ".git" || name === "node_modules") continue
    const abs = join(dir, name)
    const nextRel = rel.length === 0 ? name : `${rel}/${name}`
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(abs, repo, nextRel)
      continue
    }
    if (!st.isFile()) continue
    const lower = name.toLowerCase()
    if (!EXTS.some((e) => lower.endsWith(e))) continue
    if (st.size > MAX_BYTES) { overCap++; continue }
    let text: string
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    filesScanned++
    if (!text.includes('"$id"') && !text.includes('"$anchor"')) continue
    const ids = valuesOf(text, "$id")
    const anchors = valuesOf(text, "$anchor")
    if (ids.length === 0 && anchors.length === 0) continue
    filesWithId++
    const refs = valuesOf(text, "$ref")
    const idByBase = new Map<string, number>()
    for (const id of ids) idByBase.set(baseOf(id.value), id.offset)
    const anchorByName = new Map<string, number>()
    for (const a of anchors) anchorByName.set(a.value, a.offset)
    for (const ref of refs) {
      const raw = ref.value
      if (raw.startsWith("#/")) {
        hits.push({ repo, rel: nextRel, line: lineOf(text, ref.offset), ref: raw, kind: "pointer-fragment", declaredAt: "" })
        continue
      }
      const hash = raw.indexOf("#")
      const base = baseOf(hash < 0 ? raw : raw.slice(0, hash))
      const fragment = hash < 0 ? "" : raw.slice(hash + 1)
      const declared = idByBase.get(base)
      if (declared !== undefined) {
        if (fragment.length > 0) {
          const anchor = anchorByName.get(fragment)
          if (anchor !== undefined) {
            hits.push({ repo, rel: nextRel, line: lineOf(text, ref.offset), ref: raw, kind: "anchored-identity", declaredAt: `${lineOf(text, declared)} + anchor at line ${lineOf(text, anchor)}` })
          } else if (!fragment.startsWith("/")) {
            hits.push({ repo, rel: nextRel, line: lineOf(text, ref.offset), ref: raw, kind: "anchored-identity", declaredAt: `${lineOf(text, declared)} (id only; anchor ${fragment} not declared)` })
          }
        } else {
          hits.push({ repo, rel: nextRel, line: lineOf(text, ref.offset), ref: raw, kind: "base-identity", declaredAt: String(lineOf(text, declared)) })
        }
      }
    }
  }
}

if (!existsSync(ROOT)) {
  console.error(`root does not exist: ${ROOT}`)
  process.exit(2)
}
for (const repo of readdirSync(ROOT).sort()) {
  const dir = join(ROOT, repo)
  try {
    if (!statSync(dir).isDirectory()) continue
  } catch {
    continue
  }
  walk(dir, repo, "")
}

const byKind = new Map<string, number>()
for (const h of hits) byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + 1)
console.log(`corpus root: ${ROOT}`)
console.log(`files scanned (json family, <= ${MAX_BYTES} bytes): ${filesScanned}   over cap: ${overCap}`)
console.log(`files declaring $id or $anchor: ${filesWithId}`)
console.log(`document-declared-identity $ref hits: ${hits.length}`)
for (const [kind, n] of [...byKind.entries()].sort()) console.log(`  ${kind}: ${n}`)
console.log("")
for (const h of hits) {
  if (h.kind === "pointer-fragment") continue
  console.log(`${h.kind}  ${h.repo}/${h.rel}:${h.line}  ref=${JSON.stringify(h.ref)}  id declared at line ${h.declaredAt}`)
}
