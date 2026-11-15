// CS-DEEP-22 — is a declaration's own TYPE being published as a READ?
//
// Found while authoring the `read-collides-with-call` fixture: two rows in its own measurement
// read `Holder -> ReportDiagnostic` on the line `public ReportDiagnostic ReportDiagnostic;` and
// `ReportDiagnostic -> ReportDiagnostic` on the line of a property whose RETURN TYPE shares its
// name. A field's declared type is not a value read of the field.
//
// WHY IT SURVIVED EVERYTHING. The bare-identifier pass's entity gate (`isCSharpEntityName`)
// checks whether an identifier is the FIRST DIRECT identifier child of an entity declaration —
// `class`, `method`, `property`, `field_declaration`, and the rest. But the grammar does not put
// a field's type directly under `field_declaration`; it nests it:
//
//     field_declaration
//       variable_declaration
//         type = identifier "ReportDiagnostic"     <- the TYPE
//         variable_declarator
//           identifier "ReportDiagnostic"          <- the NAME
//
// so the parent of the type identifier is `variable_declaration`, which is not in the entity
// list, the gate returns false, and the name is read — provided the name RESOLVES, which it does
// exactly when the type name collides with a member name of the enclosing class. That is a
// self-shadowing hole the class-chain resolution cannot see, because the shadowing frame is the
// same name.
//
// The same shape reaches a parameter (`void M(Widget w)` inside a class with a `Widget` member)
// and a return type. This probe isolates all of them, each beside a control that must NOT read.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

const CASES: Array<{ name: string; src: string }> = [
  {
    name: "T1-field-type-collides-with-a-member-name (the finding)",
    src: `public class Holder { public Widget Widget; } public class Widget { }`,
  },
  {
    name: "T2-field-type-does-NOT-collide (control: no member of that name, so nothing resolves)",
    src: `public class Holder { public Widget Value; } public class Widget { }`,
  },
  {
    name: "T3-field-type-collides-with-a-DIFFERENT-member",
    src: `public class Holder { public Widget Widget; public int Other; } public class Widget { }`,
  },
  {
    name: "T4-property-return-type-collides",
    src: `public class Holder { public Widget Widget { get; set; } } public class Widget { }`,
  },
  {
    name: "T5-parameter-type-collides",
    src: `public class Holder { public void M(Widget Widget) { } } public class Widget { }`,
  },
  {
    name: "T6-local-declaration-type-collides",
    src: `public class Holder { public void M() { Widget Widget = new(); } } public class Widget { }`,
  },
  {
    name: "T7-array-element-type-collides",
    src: `public class Holder { public Widget[] Widgets; } public class Widget { }`,
  },
  {
    name: "T8-generic-argument-collides",
    src: `public class Holder { public System.Collections.Generic.List<Widget> Widget; } public class Widget { }`,
  },
  {
    name: "T9-a REAL read of the member (control: this one must still publish)",
    src: `public class Holder { public Widget Widget; public object M() { return Widget; } } public class Widget { }`,
  },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c_sharp.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  for (const c of CASES) {
    const file = path.join(ROOT, "script", "m14", "tmp", `csdeep22-${c.name.split(" ")[0]}.cs`)
    fs.writeFileSync(file, c.src + "\n")
    const res: any = await ASTEngine.parseFile(file, c.src + "\n")
    const uses = (res.relationships ?? [])
      .filter((r: any) => (r.type ?? r.relationshipType) === "uses" && String((r.metadata ?? {}).relationshipType) === "identifier_usage")
      .map((r: any) => `${r.source}->${r.target}@${r.line_number}`)
    console.log(`${c.name}\n   ${c.src}\n   bare-identifier uses: ${uses.length ? uses.join("  ") : "(none)"}\n`)
  }
}

if (import.meta.main) await main()
