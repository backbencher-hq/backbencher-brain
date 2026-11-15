// script/m14/tmp/oc-surface-diag.ts — does the census actually ADJUDICATE objective-c's
// framework contract after CONV-OC-1?
//
// A lane that stops being examined reports zero violations, which is indistinguishable
// from a repaired lane in the summary line. So this asserts the binding is LIVE: the real
// source must be clean, and a source with one contract key deleted must be convicted. The
// first version of the objc fix wrapped the metadata literal in an IIFE and failed exactly
// this check (0 sites either way), which is why the check exists.
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { scanFile } from "../../m60/framework-surface-census"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const FILE = path.join(ROOT, "src/ast/real-objective-c-analyzer.ts")

const wts: any = WTS
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
const parser = new P()
parser.setLanguage(language)

const src = readFileSync(FILE, "utf8")
const violations = (text: string) => {
  const { scan } = scanFile(parser, FILE, text)
  return scan.sites.filter((s) => s.verdict === "violation").map((s) => `${s.shape} [${s.key}]`)
}

const live = violations(src)
console.log("live source violations:", live.length ? live : "none")

const CASES: { name: string; text: string; expect: string }[] = [
  { name: "frameworkPatterns key deleted", expect: "missing-contract-key", text: src.replace(/\n        frameworkPatterns,/, "") },
  { name: "framework key deleted", expect: "missing-contract-key", text: src.replace(/\n        framework: detectedFrameworks.length > 0 \? detectedFrameworks\[0\] : undefined,/, "") },
  { name: "detectedFrameworks key deleted", expect: "missing-contract-key", text: src.replace(/\n        detectedFrameworks,/, "") },
]

let bad = 0
for (const c of CASES) {
  const got = violations(c.text)
  const ok = got.some((g) => g.includes(c.expect))
  if (!ok) bad++
  console.log(`${ok ? "CAUGHT" : "MISSED"} ${c.name}: ${got.length ? got.join(", ") : "none"}`)
}
console.log(bad === 0 ? "objc contract binding is LIVE (3/3 mutations convicted)" : `${bad} mutation(s) uncaught — the lane is not being adjudicated`)
