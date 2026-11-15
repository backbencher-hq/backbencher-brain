// Which of these residual constructs are real grammar gaps? One snippet each,
// derived from the actual failing lines of the 21-file residual.
import { ASTEngine } from "../../../src/ast/engine"

const CASES: Array<[string, string]> = [
  ["gstring-nested-dquote", 'logger.warn("Build date ${System.getenv("SOURCE_DATE_EPOCH")}")\n'],
  ["gstring-nested-dquote-file", 'def dir = file("${System.getProperty("user.home")}/.grails/x")\n'],
  ["as-generic", "def x = y as List<Map<String, String>>\n"],
  ["as-generic-simple", "def x = y as List<String>\n"],
  ["methodref-in-typed-closure", "gdoc.classpath = files(sources.collect { SourceSet it -> it.compileClasspath.filter(File.&isDirectory) }.flatten().unique())\n"],
  ["ternary-multiline", "def s = a != null\n    ? 'x'\n    : ''\n"],
  ["generic-method-decl", "Iterable<String> asArguments() {\n    return []\n}\n"],
  ["map-literal-assign", "it.attributes = [\n    'a': 1,\n    'b': 2,\n]\n"],
  ["cmd-call-elvis", "username System.getenv('X') ?: project.properties.get('Y')\n"],
  ["prop-chain-assign", "compileJava.options.release = 17\n"],
  ["closure-and", "c.allDependencies.any { it.group == 'a' && it.name == 'b' }\n"],
  ["mainclass-set", "it.mainClass.set(findProperty('startMainClass'))\n"],
  ["tasks-named", "def t = tasks.named('distZip')\n"],
  ["collect-replace", "tasks.named(n).get().classpath.files.collect { it.absolutePath.replace('\\\\', '/') }\n"],
  ["into-exclude", "it.into(layout.buildDirectory.dir('x')).exclude {\n}\n"],
  ["ext-has", "if (it.ext.has('groovydocLinks')) {\n}\n"],
  ["attr-assign-dir", "it.outputDir = project.layout.buildDirectory.dir('docs/manual').get().asFile\n"],
  ["mainclass-assign", "it.mainClass = 'grails.plugin.json.view.JsonViewCompiler'\n"],
  ["addall-as-cast", "links.addAll(it.ext.groovydocLinks as List<Map<String, String>>)\n"],
]

async function main(): Promise<void> {
  for (const [name, src] of CASES) {
    const parser = await ASTEngine.getParser("groovy" as any)
    const root = parser.parse(src)?.rootNode
    console.log(`${name.padEnd(28)} ${root?.hasError ? "FAIL" : "ok  "}`)
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
