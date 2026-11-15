import { getParser } from "../run-fixtures"
const mod: any = await import("../../../src/ast/real-csharp-analyzer")
const analyzer = new mod.RealCSharpAnalyzer()
const parser = await getParser("csharp")
const code = `public class W {
  private int x;
  public int Get() { return x; }
}
public class Inner { public Deeper deeper; }
public class Deeper { public int leaf; }
public class Ch {
  public Inner inner;
  public int Read() { return inner.deeper.leaf; }
}
`
const tree = parser.parse(code)
const r: any = analyzer.analyze(tree.rootNode, code, "probe/cs750.cs")
for (const rel of r.relationships ?? []) console.log(`${rel.type}: ${rel.source} -> ${rel.target}${rel.line_number ? " @L" + rel.line_number : ""}`)
