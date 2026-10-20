/**
 * R2 FLEET-WIDE PROBE — JAVASCRIPT. Does this lane's local-binding spelling carry the LOSS?
 *
 * R2 (charter §21.41): "A DEDUP KEY MUST CARRY THE DECLARATION'S IDENTITY WHENEVER THE ROW'S
 * IDENTITY IS THE OCCURRENCE — NOT THE NAME." MEASURED (dart lane): a local read is spelled
 * `<callable>\u0000<name>`, so two reads of TWO DIFFERENT declarations sharing a name in one
 * function spell IDENTICALLY and collapsed into one row. The loss on dart-http alone was 1,246
 * rows. THE FLEET-WIDE PROBE (one parse, no corpus): write a file with two same-named locals in
 * nested scopes, read both, and check the analyzer publishes TWO rows.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * CORRECTION LOG (2026-10-20, the javascript lane). The first version of this probe was WRONG in
 * two ways, and the second version corrected both. The corrections are recorded here because the
 * wrong version's PASS was the most dangerous kind of wrong: it reported "no loss" on a lane that
 * HAS the loss.
 *
 *   (1) IT CRASHED. It called `analyzer.analyze(root, src, { filePath })`; the analyzer's own
 *       signature is `analyze(rootNode, content, filePath, context?)` — the path is the THIRD
 *       argument and it is a STRING. The probe therefore never produced a verdict at all.
 *
 *   (2) IT COUNTED THE WRONG THING. It measured the number of DISTINCT SPELLINGS
 *       (`source\u0000target`) and compared that to an expected count. In CASE 1 (two shadowed
 *       locals named `value` in one callable) the expected count of 2 was satisfied by TWO
 *       DIFFERENT NAMES — the read of the parameter `limit` and the read of `value` — while the
 *       two reads of `value` had collapsed into ONE row. The probe said PASS; the loss was there.
 *       THE CORRECT PREDICATE IS PER NAME: the number of rows for a given binding NAME must equal
 *       the number of DECLARATIONS of that name that are read. A spelling-level count cannot see
 *       this, because the collapsed row and a row for a different name are indistinguishable in it.
 *
 *   (3) ITS FOURTH CASE EXPECTED 1 ROW FOR A FILE THAT HAS THREE BINDINGS. `total` is read twice
 *       and MUST be one row; `a` and `b` are read once each and are rows of their own. The
 *       expectation of 1 was the probe's arithmetic error, not the analyzer's behaviour — the
 *       analyzer published `total` ONCE, which is the property the case exists to protect.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS PROBED, and why each case is a different question. The probe asks the ANALYZER (it
 * publishes the rows the store sees) and counts ROWS PER BINDING NAME, printing each row's own
 * line so a reader can see WHICH read survived.
 *
 *   CASE 1 — TWO SHADOWED LOCALS IN ONE FUNCTION. The canonical R2 shape. `value` is declared in
 *     the function body and again in a nested block; both are read. TWO rows for `value` ⇒ the
 *     dedup key carries the declaration's identity. ONE row ⇒ the loss.
 *   CASE 2 — SAME NAME, TWO SEPARATE FUNCTIONS (CONTROL). The source prefix differs, so the
 *     `<callable>\u0000<name>` spelling separates them; expected to PASS even under the loss. It
 *     is the control that proves the probe measures the right thing: if CASE 2 also collapsed, the
 *     probe would be measuring a different defect (a dedup that ignores the source entirely).
 *   CASE 3 — THE SAME NAME IN TWO FUNCTIONS' PARAMETERS (CONTROL). Same shape, one more way.
 *   CASE 4 — ONE DECLARATION READ TWICE (MUST NOT SPLIT). Two reads of ONE declaration are ONE
 *     row — the occurrence is not the row's identity, and neither is the declaration distinct.
 *     This is the case a LINE-KEYED fix would break: R2 says "a line cannot tell two reads of one
 *     declaration from two reads of two declarations — it splits both".
 *
 * USAGE
 *   bun run script/m14/js-r2-identity-probe.ts
 * It is a MEASUREMENT: prints counts, writes nothing, exits 0 when every case holds and 1 when a
 * case fails (so it can be used as a gate).
 */
import { getParser } from "../../src/ast/engine"
import { RealJavaScriptAnalyzer } from "../../src/ast/real-javascript-analyzer"
import { BINDING_SEP } from "../../src/ast/types"

interface Case {
  name: string
  src: string
  /** binding name -> the number of rows the analyzer must publish for THAT NAME */
  expect: Record<string, number>
  note: string
}

const CASES: Case[] = [
  {
    name: "CASE 1 — two shadowed locals in one function",
    src: [
      "function work(limit) {",
      "  const value = 1;",
      "  if (limit) {",
      "    const value = 2;",
      "    return value;",
      "  }",
      "  return value;",
      "}",
    ].join("\n"),
    expect: { value: 2, limit: 1 },
    note: "THE R2 SHAPE. Two DIFFERENT declarations share the name `value` inside ONE callable.",
  },
  {
    name: "CASE 2 — same name, two separate functions (CONTROL)",
    src: [
      "function alpha() { const count = 1; return count; }",
      "function beta() { const count = 2; return count; }",
    ].join("\n"),
    expect: { count: 2 },
    note: "The source prefix differs, so the `<callable>\\0<name>` spelling separates these.",
  },
  {
    name: "CASE 3 — same name as a parameter in two functions (CONTROL)",
    src: [
      "function alpha(item) { return item; }",
      "function beta(item) { return item; }",
    ].join("\n"),
    expect: { item: 2 },
    note: "Parameters are bindings too; the callable prefix separates them.",
  },
  {
    name: "CASE 4 — one declaration read twice (MUST NOT SPLIT)",
    src: [
      "function once(flag) {",
      "  const total = 0;",
      "  const a = total;",
      "  const b = total;",
      "  return a + b;",
      "}",
    ].join("\n"),
    expect: { total: 1, a: 1, b: 1 },
    note: "One declaration read twice is ONE row for `total`; `a` and `b` are rows of their own.",
  },
  {
    name: "CASE 5 — two CALLS of two shadowed locals in one function (the calls side)",
    src: [
      "function work(limit) {",
      "  const fn = 1;",
      "  if (limit) {",
      "    const fn = 2;",
      "    return fn();",
      "  }",
      "  return fn();",
      "}",
    ].join("\n"),
    expect: { fn: 2 },
    note: "THE CONTROL THAT SAYS WHERE THE LOSS IS. The CALL site does not use the payload-pollution dedup, so it already publishes one row per read site — this case PASSES today, and the loss is confined to the `uses` sites (the bare read, the chain root, the call receiver).",
  },
]

interface Emitted {
  type: string
  source: string
  target: string
  line?: number
  metadata?: any
}

async function analyse(src: string): Promise<Emitted[]> {
  const parser: any = await getParser("javascript" as any)
  const tree = parser.parse(src)
  const analyzer = new RealJavaScriptAnalyzer()
  const out: Emitted[] = []
  // The analyzer's own signature is `analyze(rootNode, content, filePath, context?)` — the file
  // path is the THIRD argument, a string, not a context object.
  const res: any = analyzer.analyze(tree.rootNode, src, "probe.js", {} as any)
  const rels = res?.relationships ?? res?.context?.relationships ?? []
  for (const r of rels) {
    out.push({ type: r.type, source: r.source, target: r.target, line: r.line_number, metadata: r.metadata })
  }
  return out
}

/** The binding NAME a local-binding row names — the part after the separator. */
function bindingName(target: string): string {
  const at = target.lastIndexOf(BINDING_SEP)
  return at < 0 ? target : target.slice(at + 1)
}

let failures = 0
console.log("JAVASCRIPT R2 IDENTITY PROBE — does the local-binding spelling carry the declaration's identity?")
console.log("")

for (const c of CASES) {
  const rows = (await analyse(c.src)).filter((r) => r.metadata?.localBinding === true)
  // ROWS PER BINDING NAME — the probe's own count. NOT the number of distinct spellings: two
  // DIFFERENT names can satisfy a spelling count while the loss is present (see CORRECTION (2)).
  const byName = new Map<string, Emitted[]>()
  for (const r of rows) {
    const n = bindingName(r.target)
    const list = byName.get(n) ?? []
    list.push(r)
    byName.set(n, list)
  }

  const problems: string[] = []
  for (const [name, want] of Object.entries(c.expect)) {
    const got = byName.get(name)?.length ?? 0
    if (got !== want) problems.push(`${name}: expected ${want} row(s), measured ${got}`)
  }
  const ok = problems.length === 0
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"} · ${c.name}`)
  console.log(`       note        : ${c.note}`)
  console.log(`       expected    : ${Object.entries(c.expect).map(([n, k]) => `${k}×\`${n}\``).join(" · ")}`)
  console.log(`       measured    : ${[...byName.entries()].map(([n, l]) => `${l.length}×\`${n}\``).join(" · ") || "(no local-binding rows)"}`)
  for (const [n, list] of byName) {
    for (const r of list) {
      console.log(`       row         : ${r.type} ${r.source}${BINDING_SEP}${r.target}  line=${r.line ?? "-"}`)
    }
  }
  for (const p of problems) console.log(`       PROBLEM     : ${p}`)
  console.log("")
}

console.log(
  failures === 0
    ? "R2 PROBE: PASS — the local-binding dedup key carries the declaration's identity in the probed shapes."
    : `R2 PROBE: FAIL — ${failures} case(s) collapse distinct declarations into one row.`,
)
process.exit(failures === 0 ? 0 : 1)
