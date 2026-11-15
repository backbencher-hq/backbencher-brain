// #837 analyzer-side isolation: which languages emit `scope` on their symbols?
import * as WTS from "web-tree-sitter"

const SRC: Record<string, Record<string, string>> = {
  java: { "T.java": "package demo;\npublic class Scope {\n  private int count;\n  public int get() { return count; }\n}\n" },
  python: { "t.py": "class Widget:\n    def render(self):\n        return \"w\"\n" },
  kotlin: { "t.kt": "class Repo(private val db: String) {\n    fun query(): Int = 1\n}\n" },
  dart: { "t.dart": "class Repo {\n  int query() => 1;\n}\n" },
}

const LOAD: Record<string, () => Promise<any>> = {
  java: async () => (await import("../../../src/ast/real-java-analyzer")).RealJavaAnalyzer,
  python: async () => (await import("../../../src/ast/real-python-analyzer")).RealPythonAnalyzer,
  kotlin: async () => (await import("../../../src/ast/real-kotlin-analyzer")).RealKotlinAnalyzer,
  dart: async () => (await import("../../../src/ast/real-dart-analyzer")).RealDartAnalyzer,
}

async function main() {
  await WTS.Parser.init()
  for (const lang of Object.keys(SRC)) {
    try {
      const Ctor = await LOAD[lang]()
      const a: any = new Ctor()
      const files = SRC[lang]
      const firstFile = Object.keys(files)[0]
      const parser = new WTS.Parser()
      void parser
      // Use the engine's production parse path so the tree matches reality.
      const { parseFile } = await import("../../../src/ast/engine")
      const out: any = await parseFile(`/t/${firstFile}`, files[firstFile])
      const syms: any[] = out?.symbols ?? []
      const withScope = syms.filter((s) => s.scope)
      console.log(`${lang}: symbols=${syms.length} withScope=${withScope.length}${withScope.length ? " e.g. " + withScope.slice(0, 3).map((s) => `${s.name}→${s.scope}`).join(", ") : ""}`)
    } catch (e: any) {
      console.log(`${lang}: PROBE FAILED ${String(e).slice(0, 140)}`)
    }
  }
}
main()
