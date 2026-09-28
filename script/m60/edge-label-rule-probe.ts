// The override edge-label rule, as a table — R10's java conviction.
//
// WHY A RULE TABLE AND NOT ONLY A FIXTURE. The defect lives in a pure string
// rule that three lanes call with inputs the analyzer builds internally
// (`${ownerFqn}.${name}${signature}`, with the owner chain recursively carrying
// signatures of its own). A fixture can only exercise the shapes its author
// thought of; this enumerates the shape SPACE, shows what each superseded rule
// did on every row, and asserts the shared rule against the honest expectation.
// A sibling that ever reintroduces a local derivation has a failing row here on
// the day it does.
//
// The two superseded shapes are reproduced INLINE, from the code they came from:
//   old-java     fqn.split('.'), last two segments, each cut at '('
//                (real-java-analyzer.ts edgeLocalName, deleted this round)
//   old-cs/groovy  fqn.split('(')[0], then last two dot segments
//                (real-csharp-analyzer.ts:2188, real-groovy-analyzer.ts:1143)
import { localEdgeLabel } from "../../src/ast/override-context"

function oldJava(fqn: string): string {
  const segs = fqn.split(".")
  const last = segs[segs.length - 1].split("(")[0]
  if (segs.length < 2) return last
  const prev = segs[segs.length - 2].split("(")[0]
  return prev ? `${prev}.${last}` : last
}

function oldCsGroovy(fqn: string): string {
  return fqn.split("(")[0].split(".").slice(-2).join(".")
}

type Row = {
  /** why this row exists — a real corpus shape, a documented shape, or a malformed input */
  why: string
  fqn: string
  honest: string
}

const ROWS: Row[] = [
  { why: "plain owner (overwhelming majority of edges)", fqn: "pkg.Foo.bar(String)", honest: "Foo.bar" },
  { why: "no package", fqn: "Foo.bar(int)", honest: "Foo.bar" },
  { why: "parameterless (the signature is still attached: `()` not omitted)", fqn: "Foo.bar()", honest: "Foo.bar" },
  { why: "no owner segment at all", fqn: "bar(String)", honest: "bar" },
  { why: "no owner, no params", fqn: "bar()", honest: "bar" },
  {
    why: "QUALIFIED parameter type — the measured grails conviction (Query.Criterion is the 2nd param)",
    fqn: "org.grails.datastore.mapping.query.jpa.JpaQueryBuilder$1.handle(PersistentEntity,Query.Criterion,StringBuilder,StringBuilder,String,int,List,ConversionService,boolean,boolean)",
    honest: "JpaQueryBuilder$1.handle",
  },
  {
    why: "GENERIC parameter type — the register's second sample",
    fqn: "java.util.LinkedHashMap.removeEldestEntry(Map.Entry<String, Boolean>)",
    honest: "LinkedHashMap.removeEldestEntry",
  },
  {
    why: "fully-qualified + generic + nested generic in one parameter list",
    fqn: "Foo.bar(java.util.List<java.util.Map.Entry<String,String>>)",
    honest: "Foo.bar",
  },
  {
    why: "dotted parameter type in the LAST position (shifts the last-two window)",
    fqn: "Foo.bar(Map.Entry)",
    honest: "Foo.bar",
  },
  {
    why: "paren-bearing OWNER chain — the shape the first fix (and cs/groovy's rule) got wrong",
    fqn: "Child.getInner().anonymous_Inner.foo(String)",
    honest: "anonymous_Inner.foo",
  },
  {
    why: "paren-bearing owner chain in the MIDDLE plus a dotted parameter",
    fqn: "Outer.get().Inner.foo(Map.Entry)",
    honest: "Inner.foo",
  },
  { why: "array parameter", fqn: "Foo.bar(int[])", honest: "Foo.bar" },
  { why: "varargs / generic array", fqn: "Foo.bar(List<String>...)", honest: "Foo.bar" },
  { why: "nested call in the owner path, no params", fqn: "a().b", honest: "a.b" },
  { why: "MALFORMED: an unclosed parameter list (partial tree)", fqn: "Foo.bar(String", honest: "Foo.bar" },
  { why: "MALFORMED: trailing dot", fqn: "Foo.", honest: "Foo" },
  { why: "MALFORMED: empty segment", fqn: "a..b", honest: "a.b" },
  { why: "MALFORMED: empty input", fqn: "", honest: "" },
]

let failures = 0
process.stdout.write("fqn | shared | old-java | old-cs/groovy | honest\n")
for (const row of ROWS) {
  const shared = localEdgeLabel(row.fqn)
  const oj = oldJava(row.fqn)
  const oc = oldCsGroovy(row.fqn)
  const ojFlag = oj === row.honest ? " " : "!"
  const ocFlag = oc === row.honest ? " " : "!"
  const sharedFlag = shared === row.honest ? " " : "!!"
  if (shared !== row.honest) failures++
  process.stdout.write(
    `${sharedFlag}${row.fqn}  =>  ${JSON.stringify(shared)} | ${ojFlag}${JSON.stringify(oj)} | ${ocFlag}${JSON.stringify(oc)} | ${JSON.stringify(row.honest)}\n`,
  )
}

// Independent invariants, asserted over the same table: every honest label is
// name-shaped, which is the property the R10 census checks on live output.
function isNameShaped(s: string): boolean {
  if (s.length === 0) return true
  let start = true
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const isWord = (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36
    if (c === 46) {
      if (start) return false
      start = true
      continue
    }
    if (!isWord) return false
    start = false
  }
  return !start
}
for (const row of ROWS) {
  const shared = localEdgeLabel(row.fqn)
  if (!isNameShaped(shared)) {
    failures++
    process.stdout.write(`!! shared rule emitted a NON-NAME for ${JSON.stringify(row.fqn)}: ${JSON.stringify(shared)}\n`)
  }
}

process.stdout.write(`\nrows: ${ROWS.length}; divergences from honest: ${failures}\n`)

// Negative proof: the table would CATCH the superseded rules, i.e. it is not
// vacuous. If this reads 0, the table cannot fail and proves nothing.
const oldJavaWrong = ROWS.filter((r) => oldJava(r.fqn) !== r.honest).length
const oldCsGroovyWrong = ROWS.filter((r) => oldCsGroovy(r.fqn) !== r.honest).length
process.stdout.write(`negative proof — old-java wrong on ${oldJavaWrong}/${ROWS.length} rows; old-cs/groovy wrong on ${oldCsGroovyWrong}/${ROWS.length}\n`)
if (oldJavaWrong === 0 || oldCsGroovyWrong === 0) {
  process.stdout.write("!! the table cannot fail for at least one superseded rule — it proves nothing\n")
  failures++
}
process.exit(failures === 0 ? 0 : 1)
