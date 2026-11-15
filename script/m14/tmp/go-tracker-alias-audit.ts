// go-tracker-alias-audit.ts — is the M60 `tracker` cell under-counting?
//
// The cell is "no OPEN issue names the language as its subject", implemented as
// case-insensitive SUBSTRING matching of a hand-written alias list (plus `lang:`
// labels, which are authoritative when present). A narrow alias list is the
// safe default — a bare `go` alias would swallow "ongoing"/"algorithm" — but that
// safety has a cost: an issue whose title names the language in a phrasing the
// list never anticipated is INVISIBLE, and the lane's cell reads PASS while its
// own open work sits in the tracker (the #916 class, from the other direction).
//
// This audit asks, per language, the only question that matters:
//   which OPEN issues does the live snapshot contain that (a) carry no `lang:`
//   label, (b) are not already counted, yet (c) name the language in the title?
// It uses the matrix's OWN exported trackerHits, so it can never disagree with
// the cell it audits.
//
//   bun script/m14/tmp/go-tracker-alias-audit.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import { trackerHits } from "../../m60/lang-completion-matrix"

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..")
const SNAP = JSON.parse(readFileSync(path.join(ROOT, "validation/m49/lang-open-issues.json"), "utf8"))
const LANGS: string[] = JSON.parse(
  readFileSync(path.join(ROOT, "validation/m60/results/LCM.json"), "utf8"),
).rows.map((r: any) => r.lang)

// The spelling that must appear in the title for this audit to raise the issue.
// Deliberately WORD-shaped (bounded on non-letters) so the audit does not itself
// inherit the substring sloppiness it is looking for — a hit here is strong
// evidence the lane owns the issue, not a coincidence of letters.
const MENTION: Record<string, string[]> = {
  java: ["java"], kotlin: ["kotlin"], scala: ["scala"], groovy: ["groovy"],
  typescript: ["typescript"], javascript: ["javascript"], vue: ["vue"], svelte: ["svelte"],
  c: [" c ", "c/cpp", "c+cpp"], cpp: ["cpp", "c++"], rust: ["rust"],
  go: ["go", "golang"], csharp: ["csharp", "c#"], fsharp: ["fsharp", "f#"],
  dart: ["dart"], ruby: ["ruby"], php: ["php"], python: ["python"], swift: ["swift"],
  objc: ["objc", "objective-c"], zig: ["zig"], haskell: ["haskell"], clojure: ["clojure"],
  elixir: ["elixir"], erlang: ["erlang"], clean: ["clean"], lua: ["lua"], perl: ["perl"],
  r: ["r "], xml: ["xml"], yaml: ["yaml"], json: ["json"], css: ["css"], html: ["html"],
  sql: ["sql"], graphql: ["graphql"], hcl: ["hcl"], markdown: ["markdown"],
  makefile: ["makefile"], bash: ["bash"], powershell: ["powershell"], nim: ["nim"],
  protobuf: ["protobuf"], vb: ["vb"],
}

const isWord = (hay: string, needle: string): boolean => {
  let i = hay.indexOf(needle)
  while (i >= 0) {
    const before = i === 0 ? " " : hay[i - 1]
    const after = i + needle.length >= hay.length ? " " : hay[i + needle.length]
    const okBefore = !/[a-z0-9]/.test(before)
    const okAfter = !/[a-z0-9]/.test(after)
    if (okBefore && okAfter) return true
    i = hay.indexOf(needle, i + 1)
  }
  return false
}

let raised = 0
for (const lang of LANGS) {
  const counted = new Set(trackerHits(lang, SNAP))
  const needles = MENTION[lang] ?? [lang]
  const missed = SNAP.issues.filter((i: any) => {
    if (counted.has(i.number)) return false
    const labels: string[] = i.labels ?? []
    if (labels.some((l) => l.startsWith("lang:"))) return false
    const t = i.title.toLowerCase()
    return needles.some((n) => isWord(n.startsWith(" ") || n.endsWith(" ") ? ` ${t} ` : t, n))
  })
  if (missed.length) {
    raised += missed.length
    console.log(`${lang}: counted [${[...counted].join(",")}] MISSES ${missed.map((i: any) => i.number).join(",")}`)
    for (const i of missed) console.log(`    #${i.number}  ${i.title.slice(0, 120)}`)
  }
}
console.log(`\naudit: ${raised} uncounted open issue(s) that a title names`)
