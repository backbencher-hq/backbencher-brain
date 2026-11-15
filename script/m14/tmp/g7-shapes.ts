// G7 grammar probe: shapes that must interpolate, shapes that must not, and
// shapes that must keep parsing exactly as before.
import { ASTEngine } from "../../../src/ast/engine"

const CASES: Array<[string, string, "INTERP" | "PLAIN" | "literal-$"]> = [
  // must produce string_interpolation
  ["braced-ident", 'def s = "${field}"\n', "INTERP"],
  ["braced-call", 'def s = "${obj.method()}"\n', "INTERP"],
  ["braced-field", 'def s = "${obj.prop}"\n', "INTERP"],
  ["braced-binary", 'def s = "${a + b}"\n', "INTERP"],
  ["dollar-ident", 'def s = "value $field"\n', "INTERP"],
  ["nested-quote", 'logger.warn("d ${System.getenv("X")}")\n', "INTERP"],
  ["triple-double", 'def s = """a ${x} b"""\n', "INTERP"],
  ["mixed", 'def s = "a $x b ${y.c} d"\n', "INTERP"],
  // must NOT interpolate: single-quoted forms
  ["single-quoted", "def s = '${field}'\n", "PLAIN"],
  ["triple-single", "def s = '''a ${x} b'''\n", "PLAIN"],
  // literal dollars must still parse
  ["literal-dollar-digit", 'def s = "cost: $5"\n', "literal-$"],
  ["literal-dollar-tail", 'def s = "100$"\n', "literal-$"],
  ["literal-dollar-only", 'def s = "$"\n', "literal-$"],
  ["literal-dollar-space", 'def s = "a$ b"\n', "literal-$"],
  ["literal-dollar-dash", 'def s = "a$-b"\n', "literal-$"],
  // `a$$b`: the FIRST `$` is followed by `$`, so it is literal and the SECOND
  // starts the interpolation — that is Groovy's rule, so this case expects an
  // interpolation rather than a literal. CLI-verified: fragment `a`, literal
  // `$` at [0,10], `interpolated_identifier` `$b` at [0,11]-[0,13].
  ["dollar-dollar-name", 'def s = "a$$b"\n', "INTERP"],
  ["escaped-dollar", 'def s = "a \\$x b"\n', "PLAIN"],
  // previously-working shapes that must still parse
  ["plain-string", 'def s = "no interp"\n', "PLAIN"],
  ["empty-string", 'def s = ""\n', "PLAIN"],
  ["empty-single", "def s = ''\n", "PLAIN"],
  ["gstring-call-name", "delegate.\"$entry.key\"(entry.value)\n", "INTERP"],
  ["map-with-string", "def m = [k: \"a$x\", j: 'a$y']\n", "INTERP"],
]

async function main(): Promise<void> {
  for (const [name, src, want] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    const tree = (root?.toString() ?? "").replace(/\n/g, " ")
    // `$name` is `interpolated_identifier` (the kotlin node name, reused) and
    // `${expr}` is `string_interpolation` — both are interpolation.
    const hasInterp = tree.includes("string_interpolation") || tree.includes("interpolated_identifier")
    const expect = want === "INTERP" ? hasInterp : !hasInterp
    const tag = root?.hasError ? "PARSE-FAIL" : expect ? "ok        " : "WRONG     "
    console.log(`${tag} ${name.padEnd(22)} interp=${hasInterp ? "y" : "n"} want=${want}`)
    if (root?.hasError || !expect) console.log(`     ${tree.slice(0, 220)}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
