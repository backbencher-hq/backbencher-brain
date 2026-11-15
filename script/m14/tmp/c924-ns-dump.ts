// #924 name surface — the PUBLICATION dump, one instrument for all five lanes.
//
// `c924-name-surface-probe.ts` counts defects across the census's own sample files;
// this dump answers the narrower, harder question: on a minimal snippet that carries
// the mechanism, WHAT does the analyzer publish — the symbol name, the edge source,
// the edge target — and under which spelling. That is what a fix must move, and it is
// the only level at which "the quoting is gone" is a fact rather than a classifier's
// opinion. Run it on the unpatched replica and on the patched one and diff.
//
// Read-only, production entry (`parseFile`).
//   bun script/m14/tmp/c924-ns-dump.ts --lang kotlin,scala,zig,haskell,elixir
import * as fs from "node:fs"
import { parseFile } from "../../../src/ast/engine"

interface Case {
  lang: string
  ext: string
  what: string
  src: string
  /** Substrings that identify the mechanism's published strings, in EITHER spelling. */
  needles: string[]
}

const CASES: Case[] = [
  {
    lang: "kotlin", ext: ".kt",
    what: "Q: a backticked name; E: a call chain ending in .single()",
    src: "class T {\n  fun `test char column read and write`() {\n    assertEquals(1, dest.selectAll().where { dest.id eq 1 }.single()[dest.id].value)\n  }\n}\n",
    needles: ["test char column read and write", "dest.selectAll().where", "getMap"],
  },
  {
    lang: "scala", ext: ".scala",
    what: "Q: a backticked def name; E: an anonymous class whose parent is a call",
    src: "class T {\n  @Test def `object` = { assertEquals(1, 1) }\n  def f = new ScalaRandom(Applicative.pure(new JavaSecureRandom())) with SecureRandom\n}\n",
    needles: ["object", "ScalaRandom(Applicative", "anonymous_ScalaRandom", "ScalaRandom"],
  },
  {
    // #924 E half: the two scala mechanisms, with UNIQUE names so each published string in
    // the dump is unambiguous (the census-shaped versions of both are covered by the probe).
    lang: "scala", ext: ".scala",
    what: "E: `val alphaEnum, betaEnum = Value` — two DECLARED names, one pattern list",
    src: "object E {\n  val alphaEnum, betaEnum = Value\n}\n",
    needles: ["alphaEnum, betaEnum", "alphaEnum", "betaEnum"],
  },
  {
    lang: "zig", ext: ".zig",
    what: "Q: the @\"…\" sigil on a declaration and on a field access",
    src: "fn @\"weird function name\"() i32 {\n    return 1;\n}\ntest \"x\" {\n    _ = @TypeOf(a.foo).@\"fn\".return_type;\n}\n",
    needles: ["weird function name", "@\"fn\"", "fn"],
  },
  {
    lang: "haskell", ext: ".hs",
    what: "E: an instance head whose type application is published as the class name",
    src: "instance (GArbitrarySum f, i ~ D) => GArbitrary (M1 i c f) where\n  gArbitrary = undefined\n",
    needles: ["M1 i c", "K1 i a", "M1", "K1", "GArbitrary"],
  },
  {
    lang: "elixir", ext: ".ex",
    what: "E: a definition head split across lines by a comment",
    src: "defmodule M do\n  defp f([char | rest], counter)\n       # 7..13 is the range. 32..126 are ASCII printables.\n       when is_integer(char) and char >= 7 do\n    f(rest, counter)\n  end\nend\n",
    needles: ["7..13 is the range", "f"],
  },
  {
    lang: "elixir", ext: ".ex",
    what: "E: the comment-split head — the published name must be the source's declaration head",
    src: "defmodule M do\n  defp uniqueHeadName([char | rest], counter)\n       # unique comment marker text\n       when is_integer(char) do\n    uniqueHeadName(rest, counter)\n  end\nend\n",
    needles: ["uniqueHeadName", "unique comment marker"],
  },
  {
    lang: "elixir", ext: ".ex",
    what: "E: `import Module.Types.{Helpers, Descr}` — a group published as the module name",
    src: "defmodule M do\n  import Module.Types.{Helpers, Descr}\nend\n",
    needles: ["Module.Types.{Helpers, Descr}", "Module.Types.Helpers", "Module.Types.Descr", "Module.Types"],
  },
]

const args = process.argv.slice(2)
const want = args.includes("--lang")
  ? args[args.indexOf("--lang") + 1].split(",").map((s) => s.trim())
  : CASES.map((c) => c.lang)

const short = (s: string) => s.replace(/\s+/g, " ").slice(0, 96)
// `--all`: print EVERY published string, not only the needle hits. A needle set is a guess
// about what the fix will publish; when the guess is wrong the dump printed an empty section,
// which reads exactly like "nothing was published" (measured on the elixir comment case).
const all = args.includes("--all")

for (const c of CASES) {
  if (!want.includes(c.lang)) continue
  console.log(`\n=== ${c.lang} — ${c.what}`)
  const fake = `/tmp/c924-ns-dump/${c.lang}/sample${c.ext}`
  fs.mkdirSync(`/tmp/c924-ns-dump/${c.lang}`, { recursive: true })
  fs.writeFileSync(fake, c.src)
  let r: any
  try {
    r = await parseFile(fake, c.src)
  } catch (e: any) {
    console.log(`  parse threw: ${e?.message ?? e}`)
    continue
  }
  const hit = (s: string) => all || c.needles.some((n) => s.includes(n))
  console.log(`  symbols: ${(r.symbols ?? []).length}, relationships: ${(r.relationships ?? []).length}`)
  for (const s of r.symbols ?? []) {
    const name = String(s.name ?? "")
    if (hit(name)) console.log(`  symbol/${s.kind} name=${JSON.stringify(short(name))} id=${JSON.stringify(short(String(s.id ?? "")))}`)
  }
  for (const x of r.relationships ?? []) {
    const src = String(x.source ?? "")
    const tgt = String(x.target ?? "")
    if (hit(src) || hit(tgt)) {
      console.log(`  edge/${x.type} source=${JSON.stringify(short(src))} target=${JSON.stringify(short(tgt))}`)
    }
  }
  for (const e of r.exports ?? []) {
    const name = String(e.name ?? "")
    if (hit(name)) console.log(`  export/${e.kind} name=${JSON.stringify(short(name))}`)
  }
}
