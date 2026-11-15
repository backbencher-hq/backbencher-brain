/**
 * Is the OWED Wayland recall gap closable, and what would closing it cost?
 *
 * `DECLARATION_VOCABULARIES` (src/ast/real-xml-analyzer.ts:146) is keyed by NAMESPACE
 * URI, and the lane doc recorded the 261 `<interface>` declarations in ghostty's Wayland
 * protocol XML as owed on the grounds that the vocabulary table is "a change to a shared
 * table". That ground is false — the table is a `private static readonly` in this lane's
 * own analyzer. So the item is either closable here or refused for a real reason, and the
 * real reason has to be measured rather than asserted.
 *
 * The Wayland protocol files are NAMESPACE-LESS: the root is `<protocol name="...">` with
 * no xmlns. That is the whole difficulty. A vocabulary entry for them has to be keyed by
 * the empty namespace, so every local name in it would be claimed in EVERY namespace-less
 * XML document, and those names are prose vocabulary elsewhere.
 *
 * This probe counts the blast radius of the honest fix without changing a line of the
 * analyzer: for each admitted file it decides namespace-less-ness from the root element
 * (does the first 4 KB declare any `xmlns`?) and counts the candidate local names. No
 * parse tree, so it is not an oracle for anything the analyzer emits — it answers one
 * question about the corpus: how many documents would a namespace-less vocabulary entry
 * claim a `description` / `entry` / `copyright` / `interface` in.
 *
 *   npx tsx validation/m14/fixtures/xml/wayland-vocabulary-blast-radius.mts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const MAX_BYTES = 512 * 1024

/** The local names the Wayland protocol vocabulary declares, from the files themselves. */
const CANDIDATES = [
  "protocol", "interface", "request", "event", "arg", "enum", "entry", "description",
  "copyright", "property", "enum_bitfield",
]

const files: { abs: string; repo: string; rel: string }[] = []
for (const repo of readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, repo)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    if (detectLanguageFromPath(rel) !== "xml") continue
    const abs = path.join(dir, rel)
    files.push({ abs, repo, rel })
  }
}
console.log(`admitted xml files: ${files.length}`)

/** Namespace-less when no `xmlns` is declared in the head of the document. */
const isNamespaceLess = (head: string) => !head.includes("xmlns")

const perName = new Map<string, { files: Set<string>; occurrences: number }>()
for (const n of CANDIDATES) perName.set(n, { files: new Set(), occurrences: 0 })
let namespaceLess = 0
let namespaced = 0
let skippedTooBig = 0
let unreadable = 0

for (const f of files) {
  let text: string
  try {
    if (statSync(f.abs).size > MAX_BYTES) { skippedTooBig++; continue }
    text = readFileSync(f.abs, "utf8")
  } catch { unreadable++; continue }
  if (!isNamespaceLess(text.slice(0, 4096))) { namespaced++; continue }
  namespaceLess++
  for (const n of CANDIDATES) {
    // Only an ELEMENT start tag: `<description` or `<description>` / `<description/>`.
    let from = 0
    for (;;) {
      const at = text.indexOf(`<${n}`, from)
      if (at < 0) break
      const after = text[at + n.length + 1]
      if (after === ">" || after === " " || after === "/" || after === "\t" || after === "\n") {
        const row = perName.get(n)!
        row.occurrences++
        row.files.add(`${f.repo}/${f.rel}`)
      }
      from = at + 1
    }
  }
}

console.log(`namespace-less files: ${namespaceLess}   namespaced: ${namespaced}   skipped>512KB: ${skippedTooBig}   unreadable: ${unreadable}`)
console.log("")
console.log("local name | occurrences in namespace-less files | files")
console.log("--- | ---: | ---:")
const rows = [...perName.entries()]
  .filter(([, r]) => r.occurrences > 0)
  .sort((a, b) => b[1].occurrences - a[1].occurrences)
for (const [n, r] of rows) {
  console.log(`${n} | ${r.occurrences} | ${r.files.size}`)
}

const zero = CANDIDATES.filter((n) => (perName.get(n)?.occurrences ?? 0) === 0)
console.log("")
console.log(`candidates with 0 namespace-less occurrences: ${zero.length ? zero.join(", ") : "(none)"}`)

// The file list is what makes the refusal checkable: "entry" and "property" are claimed
// in 88 files between them, and a reader has to be able to see that those files are not
// Wayland protocol descriptions before accepting that a namespace-keyed fix would
// misfire on them.
console.log("")
console.log("example files per local name (up to 5, in sorted order):")
for (const n of CANDIDATES) {
  const r = perName.get(n)!
  if (r.occurrences === 0) continue
  const ex = [...r.files].sort().slice(0, 5)
  console.log(`  ${n}: ${ex.join(", ")}${r.files.size > 5 ? ` … (+${r.files.size - 5} more)` : ""}`)
}