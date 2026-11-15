// script/m14/tmp/dt-shape-battery.ts — corroborate the declared-type census rows
// with a SHAPE BATTERY per lane, so a `absent` verdict is a capability finding
// and not a one-snippet artifact. Prints, per lane, every reference-ish edge
// whose target names the in-file type, for four declared-type positions
// (field, parameter, return, local).
const LANES: Record<string, { ext: string; src: string }> = {
  c: {
    ext: ".c",
    src: `struct Dep { int x; };\nstruct Holder {\n  struct Dep f;\n};\nstruct Dep *m(struct Dep *a) { struct Dep *l = a; return l; }\n`,
  },
  cpp: {
    ext: ".cpp",
    src: `struct Dep { int x; };\nstruct Holder {\n  Dep f;\n  Dep m(Dep a) { Dep l = a; return l; }\n};\n`,
  },
  fsharp: {
    ext: ".fs",
    src: `type Dep() = class end\ntype Holder() =\n    let mutable f: Dep = null\n    member _.M(a: Dep) : Dep = a\n`,
  },
  powershell: {
    ext: ".ps1",
    src: `class Dep {}\nclass Holder {\n  [Dep] $f\n  [Dep] M([Dep] $a) { return $a }\n}\n`,
  },
  csharp: { ext: ".cs", src: `class Dep {}\nclass Holder {\n  private Dep f;\n  public Dep M(Dep a) { Dep l = a; return l; }\n}\n` },
  dart: { ext: ".dart", src: `class Dep {}\nclass Holder {\n  Dep? f;\n  Dep m(Dep a) { Dep l = a; return l; }\n}\n` },
  php: { ext: ".php", src: `<?php\nclass Dep {}\nclass Holder {\n  private Dep $f;\n  public function m(Dep $a): Dep { $l = $a; return $l; }\n}\n` },
  swift: { ext: ".swift", src: `class Dep {}\nclass Holder {\n  var f: Dep?\n  func m(a: Dep) -> Dep { let l = a; return l }\n}\n` },
  objc: { ext: ".m", src: `@interface Dep : NSObject\n@end\n@interface Holder : NSObject {\n  Dep *f;\n}\n- (Dep *)m:(Dep *)a;\n@end\n` },
  python: { ext: ".py", src: `class Dep:\n    pass\n\nclass Holder:\n    f: Dep\n    def m(self, a: Dep) -> Dep:\n        l: Dep = a\n        return l\n` },
}

import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const TMP = path.join(ROOT, "script/m14/tmp/.dt-shape-battery")

async function main() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  for (const [lang, spec] of Object.entries(LANES)) {
    const file = path.join(TMP, `probe${spec.ext}`)
    writeFileSync(file, spec.src)
    const res: any = await ASTEngine.parseFile(file, spec.src)
    const rels: any[] = res?.relationships ?? []
    const toDep = rels.filter((r: any) => String(r.target ?? "").split(/[\s:*&]+/).filter(Boolean).pop() === "Dep")
    const kinds = toDep.map((r: any) => `${r.type}/${r.metadata?.relationshipType ?? "-"}`)
    console.log(
      `${lang.padEnd(11)} holderSymbol=${res?.symbols?.some((s: any) => s.name === "Holder") ? "y" : "n"} ` +
        `toDep=${toDep.length} ${kinds.length ? kinds.join(", ") : ""}`,
    )
    for (const r of toDep) console.log(`              src=${r.source} line=${r.line_number} meta=${JSON.stringify(r.metadata ?? {})}`)
  }
  rmSync(TMP, { recursive: true, force: true })
}

main()
