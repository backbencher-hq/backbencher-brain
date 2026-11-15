// script/m14/tmp/dt-contract-probe.ts — read the FAMILY CONTRACT for the declared-type
// reference graph off the lanes that already implement it, before writing csharp's.
//
// The four decisions that decide whether C# comes out family-shaped or merely
// plausible:
//   source   does a FIELD's ref come from the class or the field? a PARAMETER's from
//            the method or the parameter?
//   generics `List<Dep>` — one edge or two, and named how (leaf vs full)?
//   primitives  `int` / `string` — filtered or emitted?
//   self     `class Dep { Dep _d; }` — a self-edge, or skipped?
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const TMP = path.join(ROOT, "script/m14/tmp/.dt-contract")

// One source per lane carrying all four positions at once: a field, a parameter, a
// return, a local, a generic type argument, a primitive and a self-reference.
const LANES: Record<string, { ext: string; src: string }> = {
  rust: {
    ext: ".rs",
    src: `struct Dep { x: i32 }
struct Gen { f: Vec<Dep> }
struct Selfish { me: Selfish }
struct Holder {
  f: Dep,
  n: i32,
}
fn m(a: Dep, b: i32) -> Dep {
  let l: Dep = a;
  l
}
`,
  },
  java: {
    ext: ".java",
    src: `class Dep {}
class Selfish { Dep me; }
class Holder {
  Dep f;
  int n;
  java.util.List<Dep> g;
  Dep m(Dep a, int b) { Dep l = a; return l; }
}
`,
  },
  kotlin: {
    ext: ".kt",
    src: `class Dep
class Selfish { val me: Dep? = null }
class Holder {
  val f: Dep? = null
  val n: Int = 0
  val g: List<Dep> = listOf()
  fun m(a: Dep, b: Int): Dep { val l: Dep = a; return l }
}
`,
  },
  python: {
    ext: ".py",
    src: `class Dep: pass

class Selfish:
    me: Dep

class Holder:
    f: Dep
    n: int
    g: list[Dep]

    def m(self, a: Dep, b: int) -> Dep:
        l: Dep = a
        return l
`,
  },
  typescript: {
    ext: ".ts",
    src: `class Dep {}
class Selfish { me: Dep; }
class Holder {
  f: Dep;
  n: number;
  g: Array<Dep>;
  m(a: Dep, b: number): Dep { const l: Dep = a; return l; }
}
`,
  },
}

async function main() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  for (const [lang, spec] of Object.entries(LANES)) {
    const file = path.join(TMP, `probe${spec.ext}`)
    writeFileSync(file, spec.src)
    const res: any = await ASTEngine.parseFile(file, spec.src)
    const rels: any[] = (res?.relationships ?? []).filter(
      (r: any) => r?.type === "references" && r?.metadata?.relationshipType !== undefined &&
        ["declared_type", "return_type", "type_reference"].includes(String(r.metadata.relationshipType)),
    )
    console.log(`\n=== ${lang} (${rels.length} declared/return type refs) ===`)
    for (const r of rels) {
      console.log(`  ${String(r.source).padEnd(12)} -> ${String(r.target).padEnd(14)} line=${String(r.line_number ?? "-").padStart(3)} meta=${JSON.stringify(r.metadata)}`)
    }
  }
  rmSync(TMP, { recursive: true, force: true })
}

main()
