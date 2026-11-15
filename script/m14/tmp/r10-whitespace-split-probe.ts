// script/m14/tmp/r10-whitespace-split-probe.ts
//
// The R10 `whitespace` class is convicted on a rationale stated in the census and the register:
// "no identifier in any of these languages may contain whitespace". That is a claim about the
// LANGUAGES, and it is checkable against each lane's own artifact: if the string a lane publishes
// as a whitespace-convicted TARGET is also published by that same lane as a SYMBOL NAME, then the
// language does declare identifiers containing whitespace (scala backticks, groovy quoted method
// names) and the target is honest.
//
// This probe asks that question per convicted (lang, file) pair, on the real corpus files the
// artifact names, and reports the three mechanism-based tests the split would use:
//   declaredName     target === one of the file's own published symbol names
//   operator         the last dotted segment is `operator <something>` (the C2b ruling question)
//   attributePayload the target begins with `@` (a decorator/annotation PAYLOAD, not a name)
//   expression       none of the above: source text, the real conviction
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()
const REPOS = "/home/ishaq2321/bb_tests/repositories"
const ARTIFACT = "/tmp/r10-artifact-pre.json"

function classify(target: string, symNames: Set<string>): string {
  if (symNames.has(target)) return "declaredName"
  const last = target.slice(target.lastIndexOf(".") + 1)
  if (last.startsWith("operator") && /\s/.test(last.charAt(8) ?? "")) return "operator"
  if (target.startsWith("@")) return "attributePayload"
  return "expression"
}

async function main() {
  const doc = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"))
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const tally: Record<string, Record<string, number>> = {}
  for (const row of doc.rows) {
    const lang = row.lang
    const files = new Map<string, any[]>()
    for (const a of row.anomalies ?? []) {
      if (a.klass !== "whitespace") continue
      if (!files.has(a.file)) files.set(a.file, [])
      files.get(a.file)!.push(a)
    }
    if (files.size === 0) continue
    tally[lang] = {}
    for (const [rel, anomalies] of files) {
      const abs = path.join(REPOS, rel)
      if (!fs.existsSync(abs)) {
        console.log(`MISSING FILE ${abs}`)
        continue
      }
      const src = fs.readFileSync(abs, "utf8")
      const res: any = await ASTEngine.parseFile(abs, src)
      const symNames = new Set<string>((res.symbols ?? []).map((s: any) => String(s.name)))
      const targets = new Set<string>((res.relationships ?? []).map((r: any) => String(r.target)))
      console.log(`\n${lang}  ${rel}`)
      for (const a of anomalies) {
        const k = classify(String(a.target), symNames)
        tally[lang][k] = (tally[lang][k] ?? 0) + 1
        const live = targets.has(String(a.target)) ? "live-edge" : "NOT-IN-CURRENT-PARSE"
        const hit = symNames.has(String(a.target)) ? "SYMBOL-NAME" : "-"
        // When the target IS one of the lane's own symbol names, the DECLARATION's text is
        // what decides whether the language spells that name with quote syntax. Print it.
        let ctx = ""
        if (symNames.has(String(a.target))) {
          const sym = (res.symbols ?? []).find((s: any) => String(s.name) === String(a.target))
          const st = sym?.range?.startLine ?? sym?.startLine
          const sc = sym?.range?.startColumn ?? sym?.startColumn ?? 0
          if (typeof st === "number") {
            const line = src.split("\n")[st - 1] ?? ""
            const at = line.slice(Math.max(0, sc - 2), sc + 30)
            const before = line.charAt(Math.max(0, sc - 1))
            ctx = `kind=${sym?.kind} startLine=${st} before=${JSON.stringify(before)} at=${JSON.stringify(at)}`
          }
        }
        console.log(`  ${k.padEnd(16)} ${a.type.padEnd(11)} ${hit.padEnd(12)} ${live.padEnd(20)} ${JSON.stringify(a.target).slice(0, 60)}`)
        if (ctx) console.log(`      ${ctx}`)
      }
      // The control: which symbol names of this file DO contain whitespace?
      const spaced = [...symNames].filter((n) => /\s/.test(n))
      console.log(`  control: ${spaced.length} symbol name(s) in this file contain whitespace`)
      for (const n of spaced.slice(0, 4)) console.log(`     sym ${JSON.stringify(n).slice(0, 90)}`)
    }
  }
  console.log("\n=== tally (whitespace class, by lane, by probed subclass) ===")
  for (const [lang, m] of Object.entries(tally)) console.log(`  ${lang.padEnd(8)} ${JSON.stringify(m)}`)
}

main()
