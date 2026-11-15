// #923 — the member-level implements edge: THE WHOLE OO FAMILY, one mirror snippet.
//
// java (measured first) answers interface implementation with `overrides M -> I.m`, owner-qualified,
// for BOTH abstract-base overrides and interface implementations. csharp answers it for the abstract
// base and emits NOTHING for either interface form. Before the label decision is taken, measure what
// every sibling lane publishes for the same shape: if the family already agrees on a spelling, the
// csharp contract is a mirror, not a new invention.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const INTERESTING = new Set(["implements", "extends", "overrides", "contains", "calls", "instantiates"])

const SNIPPETS: Array<{ lang: string; file: string; src: string }> = [
  {
    lang: "kotlin", file: "probe.kts.kt", src: `
package probe
interface IThing { fun getName(): String; val count: Int }
abstract class Base { abstract fun label(): String }
class Impl : Base(), IThing {
    override fun getName(): String = "n"
    override val count: Int = 1
    override fun label(): String = "l"
}
`},
  {
    lang: "php", file: "probe.php", src: `<?php
namespace Probe;
interface IThing { public function getName(): string; }
abstract class Base { abstract public function label(): string; }
class Impl extends Base implements IThing {
    public function getName(): string { return "n"; }
    public function label(): string { return "l"; }
}
`},
  {
    lang: "typescript", file: "probe.ts", src: `
interface IThing { getName(): string; }
abstract class Base { abstract label(): string; }
class Impl extends Base implements IThing {
    getName(): string { return "n"; }
    label(): string { return "l"; }
}
`},
  {
    lang: "swift", file: "probe.swift", src: `
protocol IThing { func getName() -> String }
class Base {
    func label() -> String { return "l" }
}
class Impl: Base, IThing {
    func getName() -> String { return "n" }
}
`},
  {
    lang: "dart", file: "probe.dart", src: `
abstract class IThing { String getName(); }
abstract class Base { String label(); }
class Impl extends Base implements IThing {
  String getName() => "n";
  String label() => "l";
}
`},
  {
    lang: "python", file: "probe.py", src: `
from abc import ABC, abstractmethod
class IThing(ABC):
    @abstractmethod
    def get_name(self) -> str: ...
class Impl(IThing):
    def get_name(self) -> str: return "n"
`},
  {
    lang: "ruby", file: "probe.rb", src: `
module IThing
  def get_name; "n"; end
end
class Impl
  include IThing
end
`},
  {
    lang: "csharp", file: "probe.cs", src: `
namespace Probe
{
    public interface IThing { string GetName(); int Count { get; } }
    public abstract class Base { public abstract string Label(); }
    public class Implicit : Base, IThing
    {
        public string GetName() => "n";
        public int Count => 1;
        public override string Label() => "l";
    }
    public class Explicit : IThing
    {
        string IThing.GetName() => "n";
        int IThing.Count => 1;
    }
}
`},
]

for (const { lang, file, src } of SNIPPETS) {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  let res: any
  const dir = path.join(ROOT, "script/m14/tmp/fixtures-probe")
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, file)
  try {
    fs.writeFileSync(tmp, src)
    res = await ASTEngine.parseFile(tmp, src)
  } catch (e: any) {
    console.log(`\n===== ${lang}: PARSE FAILED — ${String(e?.message ?? e).split("\n")[0]}`)
    continue
  }
  const edges = (res.relationships ?? []).filter((r: any) => INTERESTING.has(String(r.type)))
  const memberEdges = edges.filter((r: any) => /\./.test(String(r.source)) || /\./.test(String(r.target)))
  console.log(`\n===== ${lang} — ${res.relationships.length} edges; member-level (owner-qualified) ${memberEdges.length}`)
  for (const r of memberEdges) console.log(`  ${String(r.type).padEnd(11)} ${String(r.source).padEnd(20)} -> ${r.target}`)
  const ifaceish = edges.filter((r: any) => !/\./.test(String(r.source)))
  console.log(`  type-level: ${ifaceish.map((r: any) => `${r.type} ${r.source}->${r.target}`).join(" | ")}`)
  fs.rmSync(tmp)
}
