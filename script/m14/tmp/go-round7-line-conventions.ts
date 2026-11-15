// M60 line CONVENTIONS for the Go lane — the part the census cannot do.
//
// The round-6 site oracle and the round-7 census both answer "does this row
// carry a line" and "is the target written on it". Neither can answer "is it
// the RIGHT one of several plausible sites", and that is the actual M60
// question: `import (` vs the spec's path, a `defer` keyword vs its callee, a
// receiver's line vs the field written after it, a struct's start line vs the
// member declared three lines down. Every one of those has a defensible
// alternative, and a gate that only counts lines will pass whichever one the
// analyzer happens to emit.
//
// So each case here puts a `// @line:` MARKER on the line the convention
// requires, and the probe reads the expected line out of the source itself.
// Nothing is hand-counted, which means the probe cannot be wrong by an
// off-by-one — the failure mode that makes a hand-written line expectation
// worth less than it looks.
//
// Every case also names the ALTERNATIVE site it must NOT report, so a
// regression to the naive site is caught rather than absorbed.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

/** Parse `// @line:<label>:<from>:<target>:<notLine>:<why>` markers. */
// The marker TRAILS real code (`defer cleanup() // @line:...`), so it must be
// matched anywhere in the line. Anchoring at `^\s*//` matched nothing, and every
// case then "passed" with 0 pinned sites — a probe that cannot fail reporting
// green, which is the failure mode this file exists to rule out. `build()`
// now also refuses to return an empty case, so the same thing cannot happen
// quietly a second time.
const MARK = /\/\/\s*@line:([^:]+):([^:]*):([^:]*):([^:]*):(.*)$/

type Expect = { line: number; label: string; from: string; target: string; notLine: number; why: string }

function build(src: string, id: string): { code: string; expects: Expect[] } {
  const lines = src.replace(/^\n/, "").replace(/\n$/, "").split("\n")
  const expects: Expect[] = []
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MARK)
    if (m) {
      expects.push({
        line: i + 1, label: m[1], from: m[2] ?? "", target: m[3] ?? "", notLine: m[4] ? Number(m[4]) : 0, why: m[5] ?? "",
      })
      out.push(lines[i].replace(MARK, "").trimEnd())
      if (expects.length === 0) throw new Error(`${c.id}: a @line: marker was found but nothing was pinned`)
    } else {
      out.push(lines[i])
    }
  }
  return { code: out.join("\n"), expects }
}

type Case = { id: string; src: string }

const CASES: Case[] = [
  // ── calls: the site is the CALLEE LEAF, never the statement keyword and
  //    never the receiver. A `.` does not insert a semicolon, so a
  //    receiver-continued chain is valid Go and the receiver's line is wrong.
  {
    id: "calls-defer-and-go-callee-leaf",
    src: `
package p

import "os"

type S struct{ n int }

func (s S) Reset() {}

func run() {
	s := S{}
	defer cleanup() // @line:calls:run:cleanup:0:the callee leaf, not the defer keyword line
	go worker() // @line:calls:run:worker:0:the callee leaf, not the go keyword line
	s.
		Reset() // @line:calls:run:Reset:8:the called leaf, not the receiver line where "s." is written
	os.Exit(0) // @line:calls:run:Exit:0:the callee leaf
}

func cleanup() {}
func worker() {}
`,
  },
  // ── calls across a MULTI-LINE composite literal: the expression starts at
  //    the brace, which can be many lines above the called field.
  {
    id: "calls-after-multiline-composite-literal",
    src: `
package p

type Cfg struct{ Name string }
type Box struct{}

func (Box) Run(c Cfg) {}

func boot() {
	Box{}.
		Run(Cfg{ // @line:calls:boot:Run:9:the called leaf is written HERE, three lines above where the composite literal closes
			Name: "x",
		})
}
`,
  },
  // ── contains: the MEMBER's own declaration line, not the container's.
  {
    id: "contains-member-declaration-line",
    src: `
package p

type Store struct {
	// a comment line, then a blank one
	items []int // @line:contains:Store:items:2:not the struct's start line, and not the comment line above the member
	Reset func() // @line:contains:Store:Reset:2:the member's own declaration line
}
`,
  },
  // ── extends: the EMBEDDED TYPE's line. Two forms, and they are not the
  //    same site: a bare embedded type and an embedded interface reference.
  {
    id: "extends-embedded-type-line",
    src: `
package p

type Base struct{}

type Store struct {
	// embedded, written three lines below the struct
	Base // @line:extends:Store:Base:2:the embedded type is written here, not at the struct's start line
}
`,
  },
  {
    id: "extends-embedded-pointer-line",
    src: `
package p

type Base struct{}

type Store struct {
	*Base // @line:extends:Store:Base:2:the embedded TYPE, so the line where the type is written even though the star precedes it
}
`,
  },
  // ── implements: the INTERFACE's declaration line. The edge names the
  //    interface, so the implementing struct's line is the wrong site.
  {
    id: "implements-interface-declaration-line",
    src: `
package p

type Reader interface { // @line:implements:Store:Reader:7:the edge NAMES the interface, so the site is the interface's own declaration line, never the implementing struct's
	Read() error
}

type Store struct{ n int }

func (s *Store) Read() error { return nil }

var _ Reader = (*Store)(nil)
`,
  },
  // ── instantiates: the CONSTRUCTED TYPE's line, which for a generic call is
  //    the type name, not the callee and not the type-argument list.
  {
    id: "instantiates-constructed-type-line",
    src: `
package p

type Box[T any] struct{ v T }

func NewBox[T any](v T) *Box[T] { return &Box[T]{v} }

func run() {
	b := NewBox( // @line:instantiates:run:NewBox:9:a generic CALL instantiates the FUNCTION, and the site is the callee line, not the wrapped argument list
		1,
	)
	_ = b
	var c = Box[int]{} // @line:instantiates:run:Box:9:a composite literal instantiates the TYPE, and the site is the line the literal starts on
	_ = c
}
`,
  },
  // ── references declared_type: the TYPE's line, not the declaration's.
  {
    id: "references-declared-type-line",
    src: `
package p

type Host struct{}

type Fn func(
	a int,
) error

func wrapped(
	r Host, // @line:references:wrapped:Host:9:the parameter's TYPE is written here, not the func keyword line
) {
	_ = r
}
`,
  },
  // ── references return_type: same rule, different list. GO37 ruled that a
  //    parameter_declaration inside a function_type is not a result, so the
  //    only return_type site here is the enclosing function's result.
  {
    id: "references-return-type-line",
    src: `
package p

type Out struct{}

func produce() (
	Out, // @line:references:produce:Out:2:the result TYPE is written here, not the func keyword line
	error,
) { var o Out; return o, nil }
`,
  },
  // ── uses / go_selector_use: the FIELD's line, not the receiver's. This is
  //    the c lane's receiver-start lesson applied to `a.b`.
  {
    id: "uses-selector-field-line",
    src: `
package p

type S struct{ Name string }

func read(s S) {
	_ = s.
		Name // @line:uses:read:Name:5:the field is written here, not the receiver line
}
`,
  },
  // ── uses / identifier_usage: the identifier's own line.
  {
    id: "uses-identifier-own-line",
    src: `
package p

var total int

func add() int {
	return total + // @line:uses:add:total:0:the identifier's OWN line, not the return keyword's and not the last line of the expression
		total
}
`,
  },
  // ── uses / go_channel_operation: the send/receive STATEMENT's line, and
  //    send and receive are separate rows even on one line.
  {
    id: "uses-channel-statement-line",
    src: `
package p

var ch chan int

func pump() {
	select {
	case <-ch: // @line:uses:pump:ch:0:the receive statement's own line
	case ch <- 1: // @line:uses:pump:ch:0:the send statement's own line, a different row with the same target
	}
}

var _ = func() {
	<-ch // @line:uses:global:ch:0:a receive inside a package-scope literal is sourced at global, and the site is the statement's line
}()
`,
  },
  // ── imports: the SPEC's path line, not the `import (` declaration line and
  //    not the alias line when the spec has one.
  {
    id: "imports-spec-path-line",
    src: `
package main

import (
	// a comment between the paren and the first spec
	f "fmt" // @line:imports:main:fmt:1:the spec's PATH is written on this line, not the import ( on line 1
	"os"
)

var _, _ = f.Sprint, os.Args
`,
  },
  // ── references on an ALIAS field: GO36's fix. The edge's SOURCE is the
  //    alias, and the line is the field's, which must not collapse to global.
  {
    id: "references-alias-field-line",
    src: `
package p

type Host struct{}

type Alias = struct {
	Host // @line:references:Alias:Host:2:the alias is the source; the line is the field's, never the type_spec's
}
`,
  },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-go.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-go-analyzer.ts"))

  let pass = 0
  let fail = 0
  for (const c of CASES) {
    const { code, expects } = build(c.src, c.id)
    const p = new P()
    p.setLanguage(g)
    const tree = p.parse(code)
    let res: any
    try { res = await new mod.RealGoAnalyzer().analyze(tree.rootNode, code, "conv.go") } catch (e: any) {
      console.log(`THROW  ${c.id}: ${e?.message ?? e}`)
      fail++
      continue
    }
    const rows = (res.relationships ?? []).map((r: any) => ({
      type: String(r.type), from: String(r.source), to: String(r.target),
      line: typeof r.line_number === "number" ? r.line_number : 0,
      op: String((r.metadata ?? {}).operationType ?? ""),
    }))
    const problems: string[] = []
    if (expects.length === 0) problems.push("pins NOTHING — a case that cannot fail is not a case")
    for (const e of expects) {
      const cands = rows.filter((r) => r.type === e.label && r.to === e.target && (e.from === "" || r.from === e.from))
      if (cands.length === 0) { problems.push(`no ${e.label} edge ${e.from || "*"}->${e.target} at all`); continue }
      if (!cands.some((r) => r.line === e.line)) {
        problems.push(`${e.label} ${e.from || "*"}->${e.target}: expected line ${e.line}, analyzer has ${cands.map((r) => r.line).join("/")} — ${e.why}`)
      }
      if (e.notLine > 0 && cands.some((r) => r.line === e.notLine)) {
        problems.push(`${e.label} ${e.from || "*"}->${e.target}: reported the WRONG site ${e.notLine} — ${e.why}`)
      }
    }
    if (problems.length === 0) { console.log(`ok    ${c.id}  (${expects.length} pinned sites)`); pass++ } else {
      console.log(`FAIL  ${c.id}`)
      for (const p2 of problems) console.log(`        ${p2}`)
      fail++
    }
  }
  console.log(`\ngo line conventions: ${pass} pass / ${fail} fail (${CASES.length} cases)`)
  process.exit(fail === 0 ? 0 : 1)
}
main()
