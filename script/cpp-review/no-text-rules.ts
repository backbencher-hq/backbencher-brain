/**
 * NO TEXT RULES — the cpp lane's gate for the two source-hygiene classes that a
 * reviewer cannot see in a diff and a grep cannot measure correctly.
 *
 * ## What it asserts, and why a second gate rather than the existing D6
 *
 *   1. ZERO regular expressions in the lane's own sources: the analyzer, the
 *      oracle, and the census instruments. Regex over source text is how an
 *      analyzer lies — it matches comments and string literals, misses nested
 *      syntax, and breaks silently on the next grammar version.
 *   2. ZERO literal NUL bytes in those same files.
 *
 * `script/cpp-review/defect-register.ts` already has a D6 class for (1), and its
 * algorithm is a TEXT scan with regexes in the gate itself: `l.match(/\/...\/g)`
 * plus a lookbehind-ish character test on the preceding character. That algorithm
 * has two measured failure modes, both recorded rather than assumed:
 *
 *   - it does not know what a COMMENT is, so a doc comment quoting a pattern is
 *     counted as a literal (the sibling cpp round closed a finding that was a
 *     sentence of prose);
 *   - it cannot see a NUL byte at all, because `readFileSync(...).split("\n")`
 *     still works on one — which is why the NUL in the `contains` dedupe key
 *     survived from the mainline to two ontology rounds while every gate ran.
 *
 * The NUL is not cosmetic. Measured on this lane at the commit I inherited:
 * `script/m14/audit-analyzer-grammar.ts` — the shared L2 grammar-conformance gate
 * — printed
 *
 *     [warn] real-cpp-analyzer.ts: source did not parse cleanly; extraction may be incomplete
 *     cpp   FAIL  refs= 90 unknown=2
 *
 * because tree-sitter-typescript turned the NUL into an ERROR node, so cpp's whole
 * grammar-audit row was extracted from a damaged tree, and `grep` classified the
 * 4,874-line analyzer as BINARY (a plain `grep -n` over it returned
 * "binary file matches" and no lines).
 *
 * ## How it measures (no regex in this file either)
 *
 * The file is parsed with the SAME tree-sitter-typescript wasm the shared grammar
 * audit uses, and the walk looks for two NODE TYPES rather than for text:
 *
 *   `regex`                      — every regex literal the grammar produces;
 *   `new` + `RegExp`             — the constructor form, which carries no `regex`
 *                                  node at all.
 *
 * NUL is measured on the BYTES, before any decoding, because a NUL is a byte and
 * not a character.
 *
 * ## The limit of this gate, measured by its own self-test and stated here
 *
 * A regular expression QUOTED IN PROSE is invisible to it, and the self-test arm
 * `"regex literal inside a comment"` is the proof: tree-sitter-typescript gives a
 * `//` comment one opaque `comment` node and parses nothing inside it, so
 * `want 1, found 0` is the measured answer, not a bug to be papered over with a
 * wider text scan. A text scan CAN see a quoted pattern — that is exactly how D6
 * convicted a sentence of prose — and cannot tell the two apart without a
 * hand-maintained comment heuristic, which is the thing this gate exists to
 * avoid.
 *
 * So the rule is a convention with a mechanical consequence: lane sources DESCRIBE
 * a pattern in prose rather than quoting it. That is why
 * `script/m14/cpp-truth.ts`'s `collapseSpaces` names the pattern it replaced
 * instead of writing it out.
 *
 * ## It proves it can fail (self-test)
 *
 * A gate that has never reported a finding is indistinguishable from a gate that
 * cannot report one. `--selftest` parses synthetic sources — one carrying a regex
 * literal in an assignment, one calling `new RegExp`, one clean, plus the
 * comment arm above — and asserts the walker finds exactly what it should. It
 * exits non-zero if it does not, so a broken gate fails the lane instead of
 * passing it.
 *
 *   bun run script/cpp-review/no-text-rules.ts            # audit
 *   bun run script/cpp-review/no-text-rules.ts --selftest # prove the walker fires
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const ANALYZER = path.join(ROOT, "src/ast/real-cpp-analyzer.ts")
/** The lane's oracle and census instruments. All lane-owned; all covered by the
 *  same rule, because a regex in the ORACLE fabricates truth and a regex in a
 *  CENSUS fabricates a measurement. */
const LANE_SOURCES = [
  ANALYZER,
  path.join(ROOT, "script/m14/cpp-truth.ts"),
  path.join(ROOT, "script/cpp-review/ontology-census.ts"),
  path.join(ROOT, "script/cpp-review/oracle-agreement.ts"),
  path.join(ROOT, "script/cpp-review/no-text-rules.ts"),
]

type Finding = { file: string; line: number; kind: string; text: string }

async function loadTypescript(): Promise<any> {
  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default?.Language
  await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-typescript.wasm")))
  const p = new WSP()
  p.setLanguage(lang)
  return p
}

function lineOf(src: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < src.length; i++) if (src.charCodeAt(i) === 10) line++
  return line
}

/** Every `regex` node, and every `new RegExp(...)`, as findings. Tree walk only. */
function scanTree(parser: any, fileLabel: string, src: string): Finding[] {
  const out: Finding[] = []
  const tree = parser.parse(src)
  if (!tree) {
    out.push({ file: fileLabel, line: 0, kind: "PARSE-FAILED", text: "the typescript parser returned no tree" })
    return out
  }
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "regex") {
      out.push({ file: fileLabel, line: lineOf(src, n.startIndex), kind: "regex-literal", text: String(n.text).slice(0, 60) })
    }
    // `new RegExp(...)`: a `new_expression` whose CONSTRUCTOR is the identifier
    // RegExp. Carries no `regex` node, so the node-type test alone would miss it.
    if (n.type === "new_expression") {
      const ctor = n.childForFieldName?.("constructor")
      if (ctor && String(ctor.text ?? "").trim() === "RegExp") {
        out.push({ file: fileLabel, line: lineOf(src, n.startIndex), kind: "RegExp-constructor", text: String(n.text).slice(0, 60) })
      }
    }
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
  }
  tree.delete?.()
  return out
}

/** Literal NUL bytes, measured on the bytes. */
function scanBytes(fileLabel: string, bytes: Uint8Array): Finding[] {
  const out: Finding[] = []
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      out.push({ file: fileLabel, line: 0, kind: "NUL-byte", text: `byte offset ${i}` })
      break
    }
  }
  return out
}

async function selfTest(parser: any): Promise<number> {
  const cases: Array<{ name: string; src: string; want: number; note?: string }> = [
    { name: "regex literal in an assignment", src: `const a = "x"\nconst r = /::|\\s+/g\n`, want: 1 },
    { name: "regex literal inside a comment", src: `// see /::|\\s+/ for the old rule\nconst a = 1\n`, want: 0, note: "a comment is one opaque node — see the header" },
    { name: "RegExp constructor", src: `const r = new RegExp("a" + "b")\n`, want: 1 },
    { name: "clean source", src: `const s = "a::b".split(":")\nfor (const c of s) void c\n`, want: 0 },
  ]
  let failures = 0
  for (const c of cases) {
    const got = scanTree(parser, `<selftest:${c.name}>`, c.src).filter((f) => f.kind !== "PARSE-FAILED")
    const ok = got.length === c.want
    if (!ok) failures++
    console.log(`  ${ok ? "ok  " : "FAIL"} ${c.name.padEnd(34)} want ${c.want}, found ${got.length}${got.length ? ` (${got[0].kind} @${got[0].line})` : ""}${c.note ? `  — ${c.note}` : ""}`)
  }
  // and the byte test, which is the one that cannot see a character
  const nul = scanBytes("<selftest:bytes>", new Uint8Array([97, 0, 98]))
  const nulOk = nul.length === 1 && nul[0].kind === "NUL-byte"
  if (!nulOk) failures++
  console.log(`  ${nulOk ? "ok  " : "FAIL"} ${"NUL byte in a byte array".padEnd(34)} want 1, found ${nul.length}`)
  return failures
}

async function main(): Promise<void> {
  const parser = await loadTypescript()
  if (process.argv.includes("--selftest")) {
    console.log("no-text-rules selftest — the gate proving it can fail")
    const failures = await selfTest(parser)
    console.log(failures === 0 ? "\nselftest: 5 arms, each measuring what the walker can and cannot see" : `\nselftest FAILED: ${failures} arm(s) did not fire`)
    process.exitCode = failures === 0 ? 0 : 1
    return
  }

  const findings: Finding[] = []
  for (const f of LANE_SOURCES) {
    const bytes = new Uint8Array(readFileSync(f))
    findings.push(...scanBytes(path.relative(ROOT, f), bytes))
    findings.push(...scanTree(parser, path.relative(ROOT, f), new TextDecoder().decode(bytes)))
  }
  console.log(`no-text-rules — ${LANE_SOURCES.length} lane sources`)
  for (const f of LANE_SOURCES) {
    const rel = path.relative(ROOT, f)
    const own = findings.filter((x) => x.file === rel)
    const lines = readFileSync(f, "utf8").split("\n").length
    console.log(`  ${own.length === 0 ? "0" : String(own.length).padStart(2)}  ${rel} (${lines} lines)`)
    for (const x of own) console.log(`        ${x.kind} @${x.line} ${x.text}`)
  }
  console.log(`\ntotal findings: ${findings.length}`)
  if (findings.length === 0) console.log("PASS — zero regex literals, zero RegExp constructors, zero NUL bytes in the lane's sources")
  else console.log(`FAIL — ${findings.length} finding(s) above`)
  process.exitCode = findings.length === 0 ? 0 : 1
}

await main()