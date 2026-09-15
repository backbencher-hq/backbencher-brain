// M59 / M49 W21 (#841 residual): the groovy parse-failure classes that remain
// AFTER the Java-reserved-argument-key fix, each as a MINIMAL snippet measured
// through the pinned grammar — so the next round starts from a repro rather than
// from a hunch about a file.
//
// Corpus residue at the time of writing: 21 of 454 `*.gradle` files in
// grails-core @ a83f87480e0c (4.6%, down from 86 / 18.9%). Nine of those reduce
// to the classes below; the other twelve are CONTEXTUAL — their first-error line
// parses clean in isolation — and are deliberately NOT attributed here, because
// naming a construct that was never isolated is how a residual list becomes
// fiction.
//
// Backslash-bearing cases use String.raw: writing them as ordinary string
// literals double-escapes, and the first version of this probe measured the
// wrong source because of exactly that.
//
// Usage: bun script/m59/probe-groovy-residual-classes.ts
import { ASTEngine } from "../../src/ast/engine"

const CLASSES: Array<{ cls: string; cases: Array<[string, string]> }> = [
  {
    cls: "GString with a NESTED double quote inside ${ }",
    cases: [
      ["FAIL (corpus form)", 'logger.warn("Build date ${System.getenv("SOURCE_DATE_EPOCH")}")\n'],
      ["FAIL (file arg)", 'def dir = file("${System.getProperty("user.home")}/.grails/x")\n'],
      ["ok  (interp, no nested quote)", 'logger.warn("Build date ${epoch}")\n'],
      ["ok  (single-quoted: no interp)", "logger.warn('Build date ${System.getenv(\"X\")}')\n"],
    ],
  },
  {
    cls: "closure with a TYPED parameter whose body is a call on a dotted receiver",
    cases: [
      ["FAIL", "def x = a.collect { SourceSet it -> it.cp.filter(File) }\n"],
      ["FAIL (method-ref arg)", "def x = a.collect { T it -> it.b.c(File.&d) }\n"],
      ["ok  (typed, no chain call)", "def x = a.collect { SourceSet it -> it.name }\n"],
      ["ok  (untyped)", "def x = a.collect { it.cp.filter(File) }\n"],
      ["ok  (typed, bare call)", "def x = a.collect { SourceSet it -> f(File) }\n"],
    ],
  },
  {
    cls: "multi-line ternary (? / : starting a continuation line)",
    cases: [
      ["FAIL", "def s = a != null\n    ? 'x'\n    : ''\n"],
      ["ok  (one line)", "def s = a != null ? 'x' : ''\n"],
      ["ok  (operator trailing)", "def s = a != null ?\n    'x' :\n    ''\n"],
    ],
  },
  {
    cls: "command call whose argument is an elvis",
    cases: [
      ["FAIL", "username System.getenv('X') ?: project.properties.get('Y')\n"],
      ["ok  (parenthesized)", "username(System.getenv('X') ?: project.properties.get('Y'))\n"],
    ],
  },
  {
    // Stated as UNREDUCED on purpose: the exact corpus line uses a literal
    // `'\\\\'` (four backslashes in the file, two real ones after Groovy
    // unescaping) and is reproduced with String.raw below. Every control that
    // varies ONE thing about it parses clean, so the trigger is not isolated.
    cls: "UNREDUCED: long dotted chain whose tail is a closure-taking call",
    cases: [
      ["FAIL (exact corpus line)", String.raw`def x = tasks.named(taskName).get().classpath.files.collect { it.absolutePath.replace('\\', '/') }` + "\n"],
      ["ok  (closure to a local)", String.raw`def x = list.collect { it.absolutePath.replace('\\', '/') }` + "\n"],
      ["ok  (chain, trivial closure)", "def x = tasks.named(n).get().cp.files.collect { it.name }\n"],
      ["ok  (chain, no closure)", "def x = tasks.named(n).get().cp.files\n"],
      ["ok  (chain, no replace)", "def x = tasks.named(n).get().cp.files.collect { it.absolutePath }\n"],
    ],
  },
]

async function main(): Promise<void> {
  let fails = 0
  for (const { cls, cases } of CLASSES) {
    console.log(`\n=== ${cls}`)
    for (const [label, src] of cases) {
      const parser = await ASTEngine.getParser("groovy" as any)
      const root = parser.parse(src)?.rootNode
      const bad = root?.hasError === true
      if (bad) fails++
      console.log(`  ${bad ? "FAIL" : "ok  "}  ${label.padEnd(30)} ${JSON.stringify(src.trim().slice(0, 80))}`)
    }
  }
  console.log(
    `\n${fails} failing snippet(s). Each FAIL is a residual-class claim in ` +
      `reviews/m49-w21-groovy-reserved-argument-keys.md; each "ok" is the control ` +
      `that bounds it. Criterion: tree.rootNode.hasError (a hand-rolled ERROR-node ` +
      `walk false-positives on a zero-width unnamed EOF phantom — measured; see the doc).`,
  )
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
