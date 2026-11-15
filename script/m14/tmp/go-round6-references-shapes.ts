// go lane — ROUND 6: the DISCRIMINATING shapes for the `references` truth.
//
// A truth derivation that agrees with the analyzer on 1,060 of 1,060 ordinary
// declarations proves very little, because ordinary declarations have one
// shape. This script builds the shapes where two derivations SHOULD disagree
// and reports each verdict, so the agreement above is informative rather than
// tautological.
//
// Every case is a legal Go declaration, and each names the rule from
// `deriveGoDeclaredTypeRefs` that the case is testing:
//
//   R1  the type position is the `type` FIELD
//   R2  a predeclared identifier is not a declared type
//   R3  the source is the nearest enclosing named declaration
//   R4  return vs declared is the `result` FIELD, never arity
//   R5  the target is the LEAF
//   R6  one edge per (source, target, relationshipType)
//
// A case reports the analyzer's edges and the truth's edges SIDE BY SIDE, so a
// disagreement is visible as a difference rather than as a count.
//
// Run: bun script/m14/tmp/go-round6-references-shapes.ts
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"
import { deriveGoDeclaredTypeRefs } from "./go-round6-references-truth"

interface Case {
  id: string
  rule: string
  question: string
  src: string
  /** what the TRUTH derives, as "source->target:rt" */
  truth: string[]
  /** what the ANALYZER must emit; a subset is enough, `forbid` must be absent */
  expect?: string[]
  forbid?: string[]
}

const CASES: Case[] = [
  {
    id: "S1",
    rule: "R1",
    question: "a struct field whose type is written: the type field carries it",
    src: `package p

type T struct {
	A Foo
	b *Bar
}
`,
    truth: ["T->Foo:declared_type", "T->Bar:declared_type"],
  },
  {
    id: "S2",
    rule: "R2",
    question: "every predeclared identifier is excluded, including the generics-era two",
    src: `package p

type T struct {
	A int
	B string
	C error
	D any
	E comparable
	F byte
	G rune
	H bool
}
`,
    truth: [],
    forbid: ["T->int", "T->string", "T->error", "T->any", "T->comparable", "T->byte", "T->rune", "T->bool"],
  },
  {
    id: "S3",
    rule: "R4",
    question: "an UNNAMED parameter and an UNNAMED result are the same shape and must be told apart by the result FIELD",
    src: `package p

type S struct{ N int }

func onlyParams(*S, S) {}

func hasResult() (*S, error) { return nil, nil }

func mixed(s *S) (*S, error) { return nil, nil }
`,
    truth: [
      "onlyParams->S:declared_type",
      "hasResult->S:return_type",
      "mixed->S:declared_type",
      "mixed->S:return_type",
    ],
  },
  {
    id: "S4",
    rule: "R3",
    question: "a type reference inside a function body belongs to the FUNCTION, not to global",
    src: `package p

type Local struct{ N int }

func f() {
	var a Local
	var b, c *Local
	_ = a
	_ = b
	_ = c
}
`,
    truth: ["f->Local:declared_type"],
  },
  {
    id: "S5",
    rule: "R5",
    question: "a qualified type use derives the LEAF, and the type argument derives its own name",
    src: `package p

type T struct {
	A io.Writer
	B List[int]
	C *pkg.Map[string, other.Thing]
}
`,
    truth: ["T->Writer:declared_type", "T->List:declared_type", "T->int:return_type_never", "T->Map:declared_type", "T->string:never", "T->Thing:declared_type"],
  },
  {
    id: "S6",
    rule: "R1",
    question: "a TYPE CONVERSION in a var initializer: `var x = Foo(y)` names a type in VALUE position, not in a declaration's type position",
    src: `package p

type Foo struct{ N int }

var x = Foo(1)
`,
    truth: [],
  },
  {
    id: "S7",
    rule: "R1",
    question: "a composite LITERAL is a construction; but a var DECLARED WITH A TYPE still declares that type",
    src: `package p

type Foo struct{ N int }

var a = Foo{}
var b, c = Foo{}, Foo{}
var d *Foo = &Foo{}
`,
    // `a`, `b`, `c` declare NO type (their var_spec has no `type` field) — the
    // literal is a construction and is already `instantiates`. `d` DOES declare
    // the type `*Foo`, so exactly one edge is derived, attributed to `global`
    // because a package-scope var has no enclosing function. The first draft of
    // this case claimed [] and was wrong; the case is kept because getting it
    // wrong is the interesting mistake.
    truth: ["global->Foo:declared_type"],
    forbid: ["global->Foo:return_type"],
  },
  {
    id: "S8",
    rule: "R6",
    question: "three fields of the SAME type derive ONE edge (the lane's per-set convention, GO32)",
    src: `package p

type T struct {
	A Foo
	B Foo
	C Foo
}
`,
    truth: ["T->Foo:declared_type"],
  },
  {
    id: "S9",
    rule: "R1",
    question: "a generic CONSTRAINT names a type; a predeclared constraint names the language",
    src: `package p

type Pair[K comparable, V any] struct {
	Key   K
	Value V
}

type Bounded[T Number] struct {
	Inner T
}
`,
    truth: ["Pair->K:declared_type", "Pair->V:declared_type", "Bounded->Number:declared_type", "Bounded->T:declared_type"],
    forbid: ["Pair->comparable", "Pair->any", "Bounded->any"],
  },
  {
    id: "S10",
    rule: "R3",
    question: "a field's type belongs to the STRUCT, including through an alias",
    src: `package p

type Inner struct{ Q int }

type Alias = struct {
	Q Inner
}
`,
    truth: ["Alias->Inner:declared_type"],
  },
  {
    id: "S11",
    rule: "R1",
    question: "an ANONYMOUS struct or interface written inline names types in its own fields",
    src: `package p

type A struct{ N int }
type B struct{ N int }

type T struct {
	Inline struct {
		X A
		Y *B
	}
	Fn func(a A) (B, error)
}
`,
    // GO37: the inline function TYPE's result list is part of the type
    // expression, not a result this file declares, so it contributes no separate
    // return_type. Collapsed per R6, the field references exactly A and B.
    truth: ["T->A:declared_type", "T->B:declared_type"],
  },
  {
    id: "S12",
    rule: "R1",
    question: "a METHOD RECEIVER's type is a parameter declaration in the FIRST list, so it is declared_type, not return_type",
    src: `package p

type T struct{ N int }

func (t *T) M(other T) (T, error) { return T{}, nil }
`,
    truth: ["M->T:declared_type", "M->T:return_type"],
  },
  {
    id: "S13",
    rule: "R1",
    question: "a nested generic: the BASE and the ARGUMENT are separate type references",
    src: `package p

type A struct{ N int }
type B struct{ N int }

type T struct {
	M map[string]List[*A]
}
`,
    truth: ["T->List:declared_type", "T->A:declared_type"],
    forbid: ["T->string"],
  },
  {
    id: "S14",
    rule: "R1",
    question: "a channel type names the element type; a func type names params and results",
    src: `package p

type A struct{ N int }
type B struct{ N int }

type T struct {
	Ch   chan A
	Ch2  <-chan *A
	Fn   func(a A, b B) (A, error)
}
`,
    // Same GO37 ruling as S11, plus the channel element: `chan A` and
    // `<-chan *A` both name A, collapsed per R6.
    truth: ["T->A:declared_type", "T->B:declared_type"],
  },
]

const parser = await ASTEngine.getParser("go" as any)
const analyzer = new RealGoAnalyzer()

const key = (s: string, t: string, rt: string) => `${s}->${t}:${rt}`

let failures = 0
let agreements = 0
const rows: any[] = []

for (const c of CASES) {
  const tree = parser.parse(c.src)
  if (!tree?.rootNode) {
    failures++
    console.log(`FAIL ${c.id}  no parse tree`)
    continue
  }
  const res: any = await analyzer.analyze(tree.rootNode, c.src, `${c.id}.go`)
  const got = new Set<string>()
  for (const r of res.relationships ?? []) {
    const rt = String((r.metadata ?? {}).relationshipType ?? "")
    if (rt !== "declared_type" && rt !== "return_type") continue
    got.add(key(String(r.source ?? ""), String(r.target ?? ""), rt))
  }
  // The truth's own expectation list is the AUTHOR's claim; the derivation is
  // run here too, and the two are compared, so a wrong author claim is caught
  // rather than agreed with.
  const derived = new Set(deriveGoDeclaredTypeRefs(tree.rootNode).map((t) => key(t.from, t.target, t.rt)))
  const derivedSorted = [...derived].sort()
  // A claim is a SET: the rules collapse repeats (R6), so a claim that lists the
  // same edge twice is describing a pre-collapse world, not a disagreement.
  // The first draft compared against the raw list and reported a phantom EXTRA
  // for every collapsed repeat.
  const claimed = [...new Set(c.truth.filter((e) => !e.includes("never")))].sort()
  const authorOk = JSON.stringify(derivedSorted) === JSON.stringify(claimed)

  // THREE comparisons, kept apart because they mean different things:
  //   missing   — the TRUTH derives it and the analyzer does not emit it
  //   forbidden — the case names it as must-not-appear and it appears anyway
  //   extra     — the analyzer emits it and the TRUTH does not derive it
  // `extra` is measured against `derived`, never against `claimed`: the claim is
  // a human's expectation and the derivation is the instrument, and comparing an
  // instrument's output to a human's expectation proves nothing about the
  // analyzer.
  const missing = derivedSorted.filter((e) => !got.has(e))
  const forbidden = (c.forbid ?? []).filter((e) => got.has(e))
  const extra = [...got].filter((e) => !derived.has(e))
  const ok = authorOk && missing.length === 0 && forbidden.length === 0 && extra.length === 0
  if (ok) agreements++
  else failures++
  rows.push({ id: c.id, rule: c.rule, question: c.question, ok, authorOk, missing, forbidden, extra, derived: derivedSorted, analyzer: [...got].sort() })
  console.log(
    `${ok ? "ok  " : "FAIL"} ${c.id.padEnd(4)} [${c.rule}] ${c.question.slice(0, 72)}`,
  )
  if (!ok) {
    if (!authorOk) console.log(`       author claim != derivation\n         claim:     ${JSON.stringify(claimed)}\n         derived:   ${JSON.stringify(derivedSorted)}`)
    if (missing.length) console.log(`       MISSING (truth derives, analyzer does not emit): ${JSON.stringify(missing)}`)
    if (forbidden.length) console.log(`       FORBIDDEN present: ${JSON.stringify(forbidden)}`)
    if (extra.length) console.log(`       EXTRA (analyzer emits, truth does not derive): ${JSON.stringify(extra)}`)
  }
}

console.log("\n=== JSON ===")
console.log(JSON.stringify({ cases: CASES.length, agreements, failures, rows }, null, 2))
if (failures > 0) process.exit(1)
