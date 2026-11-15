// Durable control battery for the groovy #841 grammar work.
//
// Reconstructed 2026-09-15 after a session loss: rounds 1-3 were verified with
// inline heredoc probes that did not survive, so the controls are consolidated
// here once. Every case below is a shape whose *earlier* verification is what a
// later grammar change is most likely to break. Cases prefixed F/W/Y are the
// ones that caught real regressions during this work.
//
// Usage:  bun script/m14/tmp/g841-controls.ts [path/to/grammar.wasm]
// Default wasm: wasm/tree-sitter-groovy.wasm
import * as fs from "fs"

const WASM = process.argv[2] ?? "wasm/tree-sitter-groovy.wasm"

const cases: { cls: string; src: string }[] = [
  // ---- distinct lexer controls (statement-level delimiter interactions) ----
  {
    cls: "F. dollar-slashy + triple-quoted (regression canary)",
    src: "def rx = $/a/b/$\ndef t = '''multi\nline'''\n",
  },
  {
    cls: "F2. dollar-slashy alone",
    src: "def rx = $/a/b/$\n",
  },
  {
    cls: "F3. slashy division disambiguation",
    src: "def a = 6\ndef b = 2\ndef c = a / b\ndef r = /a.b/\n",
  },
  {
    cls: "F4. triple-quoted multiline alone",
    src: "def t = '''multi\nline'''\n",
  },

  // ---- round 1: typed for-in def, slashy, spread-map, block tails ----
  { cls: "R1a. typed for-in with def", src: "for (def d : deps) {\n  def rx = /a.b/\n}\n" },
  { cls: "R1b. spread-map argument", src: "class C { def m() { f(*:map) } }\n" },
  { cls: "R1c. one-line class fields", src: "class C { static final List X = [] }\n" },
  { cls: "R1d. bare return tail in block", src: "class C {\n  def m() {\n    try { return id }\n    catch (e) { throw e }\n  }\n}\n" },
  { cls: "R1e. closure bare tail", src: "class C { def m() { list.each { return it } } }\n" },

  // ---- round 2: leading-dot chains, .@ attribute, [*:m], quoted names ----
  {
    cls: "R2a. leading-dot chain",
    src: 'class C {\n  def m(p) {\n    return p\n      .getProperty("x", List) ?: []\n  }\n}\n',
  },
  { cls: "R2b. attribute access .@", src: "class C {\n  def m(o) { return o.@name }\n}\n" },
  { cls: "R2c. map-literal spread [*:m]", src: "class C {\n  def m(m2) { return [a: 1, *:m2] }\n}\n" },
  // NOTE: an earlier version of this control wrote the body as `{ expect: true }`
  // on one line and failed on the *committed* grammar too. The failing
  // construct there is a one-line `label: statement` block, not the quoted name
  // — see knownGaps below. The quoted-name claim itself is re-verified in
  // script/m14/tmp/g841-spock-names.ts (10/10 shapes, both revisions).
  { cls: "R2d. single-quoted Spock method name", src: "class S {\n  def 'a test name'() {\n    expect:\n    true\n  }\n}\n" },

  // ---- W: dotted chains ending in a call (round-2 regression you fixed) ----
  { cls: "W1. dotted chain call (layout dir)", src: "class C { def m(p) { return p.layout.buildDirectory.dir('x') } }\n" },
  { cls: "W2. dotted chain set(true)", src: "class C { def m(it) { return it.reports.xml.required.set(true) } }\n" },
  { cls: "W3. dotted chain assignment", src: "class C { def m(o) { o.a.b.c = 1 } }\n" },
  { cls: "W4. plain dotted read", src: "class C { def m(cfg) { return cfg.limit } }\n" },
  { cls: "W5. dotted chain call arg", src: "class C { def m(o) { f(o.a.b.c()) } }\n" },
  // W6 is the control that caught the 2026-09-15 round-4 regression: adding a
  // command reading to `assignment_expression` broke `String[] x = a.b.c`
  // (candidate: FAIL, committed revision: OK), which cost exactly one real
  // corpus file — grails-core GrailsApplicationPostProcessor.groovy line 313.
  { cls: "W6. array-typed local + dotted-read initializer", src: "class C {\n  void m(ac) {\n    String[] p = ac.environment.activeProfiles\n  }\n}\n" },
  { cls: "W7. same, non-array type", src: "class C {\n  void m(ac) {\n    String p = ac.environment.activeProfiles\n  }\n}\n" },

  // ---- round 3: method refs, interaction DSL, continuations, ranges ----
  { cls: "R3a. .& method reference", src: "class C {\n  def m() { registry.eachEntry(this.&validate) }\n}\n" },
  { cls: "R3b. interaction DSL slashy + >> closure", src: "class C {\n  def m(log) { log./print.*/(* _) >> { def a -> acc += a.join('') } }\n}\n" },
  { cls: "R3c. operator-first continuation (&&)", src: "class C {\n  def m(t) {\n    return t.valid\n      && ClassUtils.isPresent(t.loader)\n  }\n}\n" },
  { cls: "R3d. GString call name", src: 'class C {\n  def m(e) { delegate."$e.key"(e.value) }\n}\n' },
  { cls: "R3e. zero-arg arrow closure", src: "class C { def m() { return { -> } } }\n" },
  { cls: "R3f. exclusive range", src: "class C { def m(seq, i, d) { List g = seq[i..<(i + d)]\n return g } }\n" },
  { cls: "R3g. primitive type as value", src: "class C { def m(t) { if (t == boolean || t == int) return 'p'\n return 'b' } }\n" },
  { cls: "R3h. bare assert as closure tail", src: "class C { def m(c) { 'groovy'.each { assert c.get(it) } } }\n" },

  // ---- Y: multi-closure command chains (the round-4 target class) ----
  { cls: "Y1. single closure assign", src: "class A {\n  def f(p) {\n    p = p.then { it * 2 }\n  }\n}\n" },
  { cls: "Y2. two closures bare stmt", src: "class A {\n  def f(p) {\n    p.then { it * 2 } then { println it }\n  }\n}\n" },
  { cls: "Y4. two closures + empty args", src: "class A {\n  def f(p) {\n    p.then() { it * 2 } then() { println it }\n  }\n}\n" },
  { cls: "Y5. three closures", src: "class A {\n  def f(p) {\n    p.then { a } then { b } then { c }\n  }\n}\n" },

  // ---- X: typed closure params / generic methods (round-4 adjacent) ----
  { cls: "X2. call then closure", src: "class A { def f() { exts.any() { e -> e.endsWith('x') } } }\n" },
  { cls: "X3. juxt + typed closure", src: "class A { def f() { props.each { String k, Object v -> use(k, v) } } }\n" },
  { cls: "X4. def generic method", src: "class A {\n  def <T> T grab(String k, Class<T> t) throws Exception { return null }\n}\n" },
]

// Shapes that do NOT parse, kept visible so they are not silently forgotten and
// are not mistaken for controls. Each is measured against the committed
// revision too, so a genuine gap is never reported as a regression.
const knownGaps: { cls: string; src: string }[] = [
  {
    cls: "G1. one-line label block `{ expect: true }` (pre-existing, both revisions)",
    src: "class S {\n  def m() { expect: true }\n}\n",
  },
  {
    // Statement-position chains (Y2/Y4/Y5) parse; an assignment RHS does not.
    // Round 4 tried two mechanisms to close it and both were rejected on
    // measurement: attaching a command reading to `expression` generally broke
    // the F canary plus this control's sibling, and attaching it to
    // `assignment_expression` fixed this shape but fixed zero corpus files
    // while breaking one (W6). See the round-4 note in the milestone ledger.
    cls: "G2. multi-closure command chain on an assignment RHS (round-4 target)",
    src: "class A {\n  def f(p) {\n    p = p.then { it * 2 } then { println it }\n  }\n}\n",
  },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync(WASM))
  const parser = new P()
  parser.setLanguage(lang)

  let pass = 0
  const fails: string[] = []
  for (const c of cases) {
    const tree = parser.parse(c.src)
    const bad = (tree.rootNode as any).hasError
    if (bad) {
      fails.push(c.cls)
      console.log(`FAIL ${c.cls}`)
      const rows: string[] = []
      const walk = (n: any) => {
        if (n.type === "ERROR" || n.isMissing) {
          rows.push(
            `      ${n.startPosition.row + 1}:${n.startPosition.column} ` +
              `${n.isMissing ? "MISSING " : ""}${n.type} :: ` +
              JSON.stringify((n.text || "").split("\n")[0].slice(0, 60)),
          )
        }
        for (let i = 0; i < n.childCount; i++) {
          const ch = n.child(i)
          if (ch) walk(ch)
        }
      }
      walk(tree.rootNode)
      console.log(rows.slice(0, 3).join("\n"))
    } else {
      pass++
    }
  }
  console.log(`\n${pass}/${cases.length} controls OK  (wasm ${WASM})`)
  if (fails.length) console.log("FAILING: " + fails.join(" | "))

  const gapFails: string[] = []
  for (const g of knownGaps) {
    const tree = parser.parse(g.src)
    if ((tree.rootNode as any).hasError) gapFails.push(g.cls)
  }
  console.log(
    `known gaps still open: ${gapFails.length}/${knownGaps.length}` +
      (gapFails.length ? "\n  " + gapFails.join("\n  ") : ""),
  )
}

main()
