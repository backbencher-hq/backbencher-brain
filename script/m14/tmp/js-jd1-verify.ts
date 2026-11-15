// JD1 verification: (a) the exact reported failure, (b) a randomized differential
// old-vs-new removal pass over synthetic symbol/span/zombie sets, (c) the B5 and
// J3 contracts must be unchanged. (2026-09-26)
import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

/** The PRE-FIX implementation, verbatim, for differential comparison. */
function oldPass(symbols: any[], deadSpans: { s: number; e: number }[], b5Zombies: number[]): any[] {
  if (deadSpans.length > 0) {
    for (let i = symbols.length - 1; i >= 0; i--) {
      const r = symbols[i].range
      if (!r || r.startIndex === undefined || r.endIndex === undefined) continue
      for (const d of deadSpans) {
        if (d.s <= r.startIndex && r.endIndex <= d.e && (d.s !== r.startIndex || r.endIndex !== d.e)) {
          symbols.splice(i, 1)
          break
        }
      }
    }
  }
  if (b5Zombies.length > 0) {
    const dead = new Set(b5Zombies)
    for (let i = symbols.length - 1; i >= 0; i--) if (dead.has(i)) symbols.splice(i, 1)
  }
  return symbols
}

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-javascript.wasm")
  const p = new P(); p.setLanguage(lang)
  const a = new RealJavaScriptAnalyzer() as any
  const names = (r: any) => (r.symbols ?? []).map((s: any) => `${s.name}@${s.range?.startLine}`)

  console.log("=== A. the exact JD1 failure (nested class + get/set/data triple) ===")
  {
    const src = `class A {
  m() { class K {} ; return 1 }
  m() { return 2 }
  get x() { return 1 }
  set x(v) { this.y = v }
  x() { return 3 }
  keep() { return 4 }
}`
    const r = await a.analyze(p.parse(src).rootNode, src, "T.js", undefined)
    const got = names(r)
    console.log("   symbols = " + JSON.stringify(got))
    const has = (n: string) => got.some((x: string) => x.startsWith(n + "@"))
    const fail: string[] = []
    if (!has("keep")) fail.push("keep was DELETED (the JD1 corruption)")
    if (has("set")) fail.push("the killed setter SURVIVED (B5 invariant violated)")
    if (got.filter((x: string) => x.startsWith("x@")).length !== 1) fail.push("expected exactly one surviving x")
    console.log(fail.length ? "   FAIL: " + fail.join("; ") : "   ok: keep survives, setter dies, one x")
  }

  console.log("\n=== B. the two control shapes (must be unchanged by the fix) ===")
  for (const [label, src] of [
    ["no nested symbol", `class A {
  m() { return 1 }
  m() { return 2 }
  get x() { return 1 }
  set x(v) { this.y = v }
  x() { return 3 }
  keep() { return 4 }
}`],
    ["nested object (local, not a symbol)", `class A {
  m() { const o = { deep: 1 } ; return o }
  m() { return 2 }
  get x() { return 1 }
  x() { return 3 }
  keep() { return 4 }
}`],
  ] as Array<[string, string]>) {
    const r = await a.analyze(p.parse(src).rootNode, src, "T.js", undefined)
    console.log(`   ${label}: ${JSON.stringify(names(r))}`)
  }

  console.log("\n=== C. J3 last-wins + B5 accessor-pair contracts (regression) ===")
  for (const [label, src, mustHave, mustNotHave] of [
    ["J3 duplicate methods -> last body wins", `class A { foo() { return 1 }\n foo() { return 2 } }`, ["foo@2"], []],
    ["B5 get/set pair -> BOTH survive", `class A { get val() { return track(1) }\n set val(v) { wrap(v) } }`, ["val@1", "val@2"], []],
    ["B5 data member kills the accessor", `class A { get x() { return makeX() }\n x() { return 1 } }`, ["x@2"], ["x@1"]],
  ] as Array<[string, string, string[], string[]]>) {
    const r = await a.analyze(p.parse(src).rootNode, src, "T.js", undefined)
    const got = names(r)
    const miss = mustHave.filter((m) => !got.includes(m))
    const extra = mustNotHave.filter((m) => got.includes(m))
    const rels = (r.relationships ?? []).map((x: any) => `${x.type}:${x.source}->${x.target}`)
    console.log(`   ${label}: ${JSON.stringify(got)}`)
    console.log(`      rels: ${JSON.stringify(rels.filter((x) => /track|wrap|makeX/.test(x)))}`)
    console.log(miss.length || extra.length ? `      FAIL miss=${JSON.stringify(miss)} extra=${JSON.stringify(extra)}` : "      ok")
  }

  console.log("\n=== D. randomized differential: old pass vs new pass, 20000 random cases ===")
  const rnd = mulberry32(20260926)
  let agree = 0, differ = 0
  const diffExamples: string[] = []
  for (let t = 0; t < 20000; t++) {
    const n = 1 + Math.floor(rnd() * 8)
    const syms: any[] = []
    for (let i = 0; i < n; i++) {
      const s = Math.floor(rnd() * 100)
      const e = s + Math.floor(rnd() * 20)
      syms.push({ name: "s" + i, range: { startIndex: s, endIndex: e, startLine: i + 1 } })
    }
    const spans: { s: number; e: number }[] = []
    const nSpans = Math.floor(rnd() * 3)
    for (let i = 0; i < nSpans; i++) {
      const s = Math.floor(rnd() * 100)
      spans.push({ s, e: s + Math.floor(rnd() * 30) })
    }
    const zom: number[] = []
    const nZom = Math.floor(rnd() * 3)
    for (let i = 0; i < nZom; i++) zom.push(Math.floor(rnd() * n))

    const a1 = oldPass(syms.map((x) => ({ ...x, range: { ...x.range } })), spans.map((x) => ({ ...x })), [...zom])
    const a2 = newPass(syms.map((x) => ({ ...x, range: { ...x.range } })), spans.map((x) => ({ ...x })), [...zom])
    const k1 = JSON.stringify(a1.map((x: any) => x.name))
    const k2 = JSON.stringify(a2.map((x: any) => x.name))
    if (k1 === k2) agree++
    else {
      differ++
      if (diffExamples.length < 3) diffExamples.push(`n=${n} spans=${JSON.stringify(spans)} zombies=${JSON.stringify(zom)}\n        old=${k1}\n        new=${k2}`)
    }
  }
  console.log(`   agree=${agree} differ=${differ}`)
  for (const e of diffExamples) console.log("      " + e)
  console.log(differ === 0
    ? "   NOTE: 0 differences means the fix is a strict refactor on RANDOM inputs —"
      + " the real-world divergence needs the specific index-shift shape (verified in A)."
    : "   differ>0 confirms the two passes are not equivalent (expected: the old one is wrong).")
}

/** The POST-FIX rule, replicated exactly as it now reads in the analyzer. */
function newPass(symbols: any[], deadSpans: { s: number; e: number }[], b5Zombies: number[]): any[] {
  const deadIdx = new Set<number>(b5Zombies)
  if (deadSpans.length > 0) {
    for (let i = 0; i < symbols.length; i++) {
      const r = symbols[i].range
      if (!r || r.startIndex === undefined || r.endIndex === undefined) continue
      for (const d of deadSpans) {
        if (d.s <= r.startIndex && r.endIndex <= d.e && (d.s !== r.startIndex || r.endIndex !== d.e)) {
          deadIdx.add(i)
          break
        }
      }
    }
  }
  if (deadIdx.size > 0) {
    for (let i = symbols.length - 1; i >= 0; i--) if (deadIdx.has(i)) symbols.splice(i, 1)
  }
  return symbols
}
main().catch((e) => { console.error(e); process.exit(1) })
