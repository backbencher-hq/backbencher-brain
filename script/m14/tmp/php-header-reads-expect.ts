// Generate validation/m14/fixtures/php/header-reads.expectation.json from the
// MEASUREMENT (never transcribed), with forbids AUTHORED for the two defects
// this round fixed plus the shapes the fixture exists to keep silent.
import * as fs from "fs"
import * as path from "path"
import { RealPhpAnalyzer } from "../../../src/ast/real-php-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const FIX = path.join(ROOT, "validation/m14/fixtures/php/header-reads.php")

const META_KEYS = ["isConstRead", "isMemberRead", "isConstFetch", "isLocalRead", "isGlobalRead", "isTearOff"]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm")))
  const src = fs.readFileSync(FIX, "utf8")
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  const r: any = await new RealPhpAnalyzer().analyze(root, src, "header-reads.php")

  const expect = (r.relationships ?? [])
    .filter((x: any) => ["calls", "uses", "instantiates", "references", "extends", "implements", "overrides", "contains"].includes(String(x.type).toLowerCase()))
    .map((x: any) => {
      const entry: Record<string, any> = { type: String(x.type).toLowerCase(), from: x.source, target: x.target }
      if (typeof x.line_number === "number") entry.line_number = x.line_number
      for (const k of META_KEYS) if (x.metadata?.[k] === true) entry[`meta.${k}`] = true
      return entry
    })
    .sort((a: any, b: any) => (a.type + a.from + a.target).localeCompare(b.type + b.from + b.target))

  const doc = {
    fixtureId: "php/header-reads",
    language: "php",
    authoredBeforeAnalyzerRun: true,
    rationale:
      "M60 php lane — reads in a callable's DECLARATION HEADER. Two defects this round fixed, both found by measurement and not by reading code. (1) A fully-qualified call (`\\is_file(...)`, `\\spl_autoload_register(...)`) was taken from the callee's RAW text, so `PHP_BUILTINS.has(\"\\\\is_file\")` was false (the set holds bare names), a builtin escaped the filter, and the lane published a target no other relationship can spell. Measured on phpunit FULL EXTENT (2,907 files): 12 such edges, 10 of them builtins. (2) The oracle gates its read rules on `inBody`, whose boundary is the callable SUBTREE, so it reads a parameter DEFAULT and an attribute ARGUMENT as expressions (they are evaluated at call time); the analyzer's extracted walk visited those positions with a SUBSET of its read rules and emitted nothing for `= self::DEFAULT` / `#[Spec(self::NAME)]`. The corpus instance was phpunit's only non-`calls` MISSING edge: `Result::from(..., int $shellExitCode = self::SUCCESS)`. The fixture pins the boundary too: the SAME attribute on a CLASS is outside any callable, so no read is expected there and `forbidRelationships` names it.",
    expectRelationships: expect,
    forbidRelationships: [
      // Defect 1 — the raw-text target. A builtin must stay FILTERED (no edge),
      // and a userland call must publish the BARE name.
      { type: "calls", target: "\\is_file", note: "fully-qualified builtin: PHP_BUILTINS holds bare names, so the raw text escaped the filter and fabricated this edge (phpunit FULL EXTENT: 10 like it)" },
      { type: "calls", target: "\\spl_autoload_register", note: "the canonicalisation half: leaf-then-builtin, exactly as the oracle states it" },
      { type: "references", target: "\\stdClass", note: "targets are bare names everywhere else in the lane (leafName in processObjectCreation, the name field in the scoped/member calls)" },
      // Defect 2 — the header-read boundary, from the other side: the attribute
      // NAME is a name, never a read of a file const.
      { type: "uses", target: "Attribute", note: "an attribute's own name is not a value read" },
      { type: "uses", target: "Spec", note: "same, for the attribute applied to a method and to a class" },
      // The deliberate boundary: outside a callable, truth is silent.
      { type: "uses", from: "Decorated", target: "DEFAULT", note: "class-level attribute argument: not inside any callable, so NOT a read" },
      // Declaring positions never read; primitive types are never edges.
      { type: "uses", target: "int" },
      { type: "uses", target: "string" },
      { type: "references", target: "int" },
      { type: "references", target: "string" },
      { type: "uses", target: "void" },
    ],
  }
  const out = path.join(ROOT, "validation/m14/fixtures/php/header-reads.expectation.json")
  fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n")
  console.log(`wrote ${out}: ${expect.length} expect, ${doc.forbidRelationships.length} forbid`)
  for (const e of expect) console.log("  ", JSON.stringify(e))
}
main()
