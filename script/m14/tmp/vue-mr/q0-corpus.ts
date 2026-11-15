// Q0 — CORPUS STATE. The vue lane's pinned corpora, and what the repository's
// own instruments report about them.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"

async function main() {
  const { LANG_REPOS, SECOND_CORPUS, corpusPath } = await import(path.join(ROOT, "script/m14/differential.ts"))

  console.log("=== Q0.1  vue corpus pins, as declared in script/m14/differential.ts ===")
  for (const [label, pin] of [["LANG_REPOS.vue", LANG_REPOS.vue], ["SECOND_CORPUS.vue", SECOND_CORPUS.vue]] as const) {
    const resolved = corpusPath(pin)
    const exists = fs.existsSync(resolved)
    let files = "n/a"
    if (exists) {
      let n = 0
      const walk = (d: string, depth: number) => {
        if (depth > 12) return
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.name === ".git" || e.name === "node_modules") continue
          const p = path.join(d, e.name)
          if (e.isDirectory()) walk(p, depth + 1)
          else if (e.name.endsWith(".vue")) n++
        }
      }
      walk(resolved, 0)
      files = String(n)
    }
    console.log(`  ${label.padEnd(22)} pin=${JSON.stringify(pin).padEnd(22)} -> ${resolved}  ${exists ? `EXISTS (${files} .vue)` : "ABSENT"}`)
  }

  console.log("\n=== Q0.2  every other lane's pins, for comparison ===")
  const langs = Object.keys(LANG_REPOS)
  const absent: string[] = []
  for (const l of langs) {
    for (const pin of [LANG_REPOS[l], SECOND_CORPUS[l]].filter(Boolean) as string[]) {
      const r = corpusPath(pin)
      if (!fs.existsSync(r)) { absent.push(`${l}:${pin}`); }
    }
  }
  console.log(`  lanes with pins: ${langs.length}`)
  console.log(`  ABSENT pins (${absent.length}): ${absent.join(", ") || "none"}`)

  console.log("\n=== Q0.3  what the sealed vue evidence claims ===")
  const claims: Array<[string, string]> = [
    ["validation/m12/results/vue-corpus-errors.json", ""],
    ["validation/m14/results/vue-differential.json", ""],
    ["validation/m11/results/web-corpus-observed.json", ""],
    ["validation/m14/fixture-baseline.json", ""],
  ]
  for (const [rel] of claims) {
    const p = path.join(ROOT, rel)
    if (!fs.existsSync(p)) { console.log(`  MISSING  ${rel}`); continue }
    const j = JSON.parse(fs.readFileSync(p, "utf8"))
    const corpus = j.corpus ?? j.corpusDir ?? j.corpusRepo ?? ""
    const exists = typeof corpus === "string" && corpus.startsWith("/") ? fs.existsSync(corpus) : "n/a"
    const nums = Object.entries(j)
      .filter(([k]) => /passed|error|coverage|files|rate|count|explained|missing|precision|recall|false/i.test(k) && typeof j[k] !== "object")
      .slice(0, 12).map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(`  ${rel}\n      corpus=${corpus} exists=${exists}\n      ${nums}`)
  }

  console.log("\n=== Q0.4  every repository under bb_tests that holds .vue files ===")
  const found: Array<[string, number]> = []
  const walkTop = (d: string, depth: number) => {
    if (depth > 2) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const p = path.join(d, e.name)
      if (e.name === "node_modules" || e.name === ".git") continue
      let n = 0
      const count = (q: string, dep: number) => {
        if (dep > 10) return
        let es: fs.Dirent[]
        try { es = fs.readdirSync(q, { withFileTypes: true }) } catch { return }
        for (const x of es) {
          if (x.name === ".git" || x.name === "node_modules") continue
          const xp = path.join(q, x.name)
          if (x.isDirectory()) count(xp, dep + 1)
          else if (x.name.endsWith(".vue")) n++
        }
      }
      count(p, 0)
      if (n > 0) found.push([p, n])
      walkTop(p, depth + 1)
    }
  }
  walkTop("/home/ishaq2321/bb_tests", 0)
  for (const [p, n] of found) console.log(`  ${n.toString().padStart(5)} .vue   ${p}`)
  if (!found.length) console.log("  (none)")

  console.log("\n=== Q0.5  any .vue SFC anywhere on the machine (excl. node_modules/.git) ===")
  const out = (await import("child_process")).execSync(
    `find /home/ishaq2321 -name '*.vue' -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -50`,
    { encoding: "utf8", maxBuffer: 1 << 24 },
  ).trim().split("\n").filter(Boolean)
  console.log(`  ${out.length} path(s) (capped at 50):`)
  for (const o of out.slice(0, 12)) console.log(`    ${o}`)
}
main()
