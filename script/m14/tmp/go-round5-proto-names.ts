// go lane — ROUND 5, the prototype-name crash class (GO35).
//
// A Go identifier may be any Unicode letter followed by letters and digits.
// That INCLUDES `constructor`, `toString`, `valueOf`, `hasOwnProperty`,
// `__proto__` and the rest of `Object.prototype`, so any plain-object map in
// the analyzer whose key is a Go name is a live crash surface, not a theoretical
// one. The F5 oracle already builds all five of its name-keyed maps with
// `Object.create(null)` and says why in its own comment — a legal Go type named
// `constructor`/`toString`/`valueOf` "once made the go lane CRASH OUTRIGHT on
// go-tools/go/callgraph/vta/vta.go". The analyzer never received the same
// defence.
//
// This class was FOUND BY THE FULL-EXTENT READ, not by a gate: running
// `go-799-surface.ts` over go-tools (1,931 files) after the GO34 hoist crashed
// with `TypeError: {} is not iterable` at `collectGoPromotedMethods`, on
// go-tools' own `go/callgraph/vta/vta.go` — the exact file the oracle's comment
// names. The hoist did not create the defect; it removed the accidental
// restriction that had kept it unreachable. A corpus read is a finding
// instrument, and this is what it found where 1,931-file gates had not.
//
// A crash cannot be fixture-pinned, so the pin is a probe. It is deliberately
// boring: eight names, each declared as a struct that EMBEDS another type (so
// the embedding map is written), declares methods (so the implements pass walks
// them), and is embedded in a type ALIAS (so the alias path runs too).
//
// Run: bun script/m14/tmp/go-round5-proto-names.ts
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

// Every `Object.prototype` member that is TRUTHY and not a function returning an
// array, plus the ones that are the classic footguns. A Go type may carry any of
// these names.
const NAMES = [
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__proto__",
]

// One shape per name, exercising every map the round made prototype-free:
//   - the type EMBEDS `*E0`, so `embeddedOf[type]` is written AND read;
//   - it declares methods, so the implements pass and the promoted-method
//     closure both run over a name that shadows a prototype member;
//   - a type ALIAS of it runs the alias-to-struct embedding path;
//   - `comparable` is embedded in an interface, so the constraint_elem path runs;
//   - a struct TAG whose key is the same name exercises `parseStructTags`, the
//     fourth map the round made prototype-free.
const sourceFor = (n: string): string =>
  `package p

type E0 struct{ Z int }

func (e *E0) M() int { return e.Z }

type ${n} struct {
	*E0
	N int \`json:"${n}" tag:"${n}"\`
}

func (c *${n}) Shared() {}

type Alias = struct{ *${n} }

type I interface {
	Shared()
}

type U interface{ comparable }

var _ = Alias{}
`

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()

let failures = 0
const rows: any[] = []
for (const n of NAMES) {
  const src = sourceFor(n)
  const tree = parser.parse(src)
  const rel = `${n}.go`
  if (!tree?.rootNode) {
    failures++
    console.log(`FAIL  ${n.padEnd(22)} no parse tree`)
    continue
  }
  try {
    const res: any = await analyzer.analyze(tree.rootNode, src, rel)
    // The point is not merely "did not throw": the type must be PUBLISHED, so a
    // future change cannot silence the class by dropping the name.
    const published = (res.symbols ?? []).some((s: any) => s.name === n)
    const implEdges = (res.relationships ?? [])
      .filter((x: any) => String(x.type) === "implements")
      .map((x: any) => `${x.source}->${x.target}`)
    if (!published) {
      failures++
      console.log(`FAIL  ${n.padEnd(22)} the type was not published (the crash was silenced, not fixed)`)
      continue
    }
    rows.push({ name: n, published, implements: implEdges })
    console.log(`ok    ${n.padEnd(22)} published, implements=[${implEdges.join(",")}]`)
  } catch (e: any) {
    failures++
    console.log(`FAIL  ${n.padEnd(22)} THREW ${String(e?.message ?? e).slice(0, 110)}`)
  }
}

const summary = {
  probe: "go-round5-proto-names",
  names: NAMES.length,
  failures,
  rows,
}
console.log("\n=== JSON ===")
console.log(JSON.stringify(summary, null, 2))
if (failures > 0) process.exit(1)
console.log(`\nall ${NAMES.length} prototype-named Go types handled`)
