import * as WTS from "web-tree-sitter"
import { RealKotlinAnalyzer } from "../../../src/ast/real-kotlin-analyzer"

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-kotlin.wasm")
  const p = new P()
  p.setLanguage(lang)
  const a = new RealKotlinAnalyzer() as any
  const run = async (name: string, src: string, checks: (r: any, root: any) => void) => {
    const root = p.parse(src).rootNode
    const r = await a.analyze(root, src, `T.kt`, undefined)
    try { checks(r, root); console.log("ok   " + name) } catch (e: any) { console.log("FAIL " + name + " :: " + e.message) }
  }
  const rels = (r: any, type: string) => (r.relationships ?? []).filter((x: any) => String(x.type).toLowerCase() === type)
  const syms = (r: any, name: string) => (r.symbols ?? []).filter((s: any) => s.name === name)

  await run("K25 nested member exported", `class Outer {\n class Inner\n fun foo() = 1\n}`, (r) => {
    const ex = (r.exports ?? []).map((e: any) => e.name)
    if (ex.includes("Inner") || ex.includes("foo")) throw new Error("nested leaked (claim TRUE): " + JSON.stringify(ex))
  })
  await run("K25b internal exported", `internal class Hidden`, (r) => {
    const ex = (r.exports ?? []).map((e: any) => e.name)
    if (ex.includes("Hidden")) throw new Error("internal exported (claim TRUE)")
  })
  await run("K14 lambda-local val", `class A {\n fun f() = list.map { val y = it * 2; y }\n}`, (r) => {
    const y = syms(r, "y")
    if (y.length) throw new Error("lambda-local y emitted as member (claim TRUE): " + JSON.stringify(y.map((s: any) => s.ownerName)))
  })
  await run("K16 normal typed prop extension flag", `class A {\n val x: List<String> = listOf()\n}`, (r) => {
    const x = syms(r, "x")[0]
    if (!x) throw new Error("no x")
    if (x.metadata?.isExtension) throw new Error("normal prop flagged extension (claim TRUE): " + x.metadata.extensionReceiver)
  })
  await run("K16b real extension prop", `val String.lastChar: Char\n get() = this[length - 1]`, (r) => {
    const s = syms(r, "lastChar")[0]
    if (!s?.metadata?.isExtension) throw new Error("real extension missed: " + JSON.stringify(s?.metadata))
  })
  await run("K7 expr-body return Unit", `fun f() = 42`, (r) => {
    const f = syms(r, "f")[0]
    if (f?.returnType === "Unit") throw new Error("inferred-Int reported Unit (claim TRUE)")
    console.log("   returnType=" + f?.returnType)
  })
  await run("K8 call default not optional", `fun f(x: Int = compute()) = x`, (r) => {
    const f = syms(r, "f")[0]
    console.log("   params=" + JSON.stringify(f?.parameters))
    if (f?.parameters?.[0] && !f.parameters[0].isOptional) throw new Error("call default missed (claim TRUE)")
  })
  await run("K9 named route arg", `class C {\n @GetMapping(value = "/x")\n fun h(): String = "x"\n}`, (r) => {
    const h = syms(r, "h")[0]
    console.log("   apiContractPath=" + h?.apiContractPath)
    if (h?.apiContractPath !== "/x") throw new Error("route garbage (claim TRUE)")
  })
  await run("K26 comment smart casts", `// this is a test\nclass A`, (r) => {
    const pats: string[] = (r.metadata as any)?.patterns ?? []
    if (pats.includes("Smart Casts")) throw new Error("comment triggers Smart Casts (claim TRUE)")
  })
  await run("K26b ident let/apply", `class A {\n fun letIt() = 1\n}`, (r) => {
    const pats: string[] = (r.metadata as any)?.patterns ?? []
    if (pats.includes("Higher-Order Functions")) throw new Error("ident triggers HOF (claim TRUE)")
  })
  await run("K27 andand complexity", `fun f(a: Boolean, b: Boolean) = a && b`, (r, root) => {
    const st: any[] = [root]; const types = new Set<string>()
    while (st.length) { const n = st.pop(); types.add(n.type); for (let i = 0; i < n.namedChildCount; i++) st.push(n.namedChild(i)) }
    console.log("   has_conj=" + types.has("conjunction_expression") + " has_infix=" + types.has("infix_expression") + " file_cx=" + (r.metadata as any)?.cyclomaticComplexity + " sym_cx=" + JSON.stringify(syms(r, "f")[0]?.complexity))
    if (syms(r, "f")[0]?.complexity === 1) throw new Error("&& uncounted (claim TRUE)")
  })
  await run("K34 override guess no declarer", `open class Bar\nclass Sub : Bar() {\n override fun foo() = 1\n}`, (r) => {
    const ov = rels(r, "overrides")
    console.log("   overrides=" + JSON.stringify(ov))
    // KAD-MR3 K34 ruling (M49.K1): the guess edge to a non-declarer STAYS —
    // M37.10 family convention (java/php/ruby external-base ruling): when no
    // in-file declarer exists, the first-supertype guess is emitted at 0.5 /
    // inferred / "first-supertype-guess", BELOW the 0.7 consumer threshold.
    // What the K2 fix removed is the UNTIERED guess: a declarable in-file
    // target must verify at 0.9/structural, and the payload must carry the
    // signature. Pin the honest tier, not suppression.
    if (ov.length) {
      const e = ov[0]
      if (e.confidence !== 0.5 || e.metadata?.evidenceClass !== "inferred" || e.metadata?.reasonCode !== "first-supertype-guess")
        throw new Error("guess edge not honestly tiered (post-K2 pin)")
    }
  })
  await run("K36 data class phantoms", `data class User(val name: String)`, (r) => {
    const u = syms(r, "User")[0]
    console.log("   isData=" + u?.metadata?.isData + " mods=" + JSON.stringify(u?.metadata?.modifiers))
    const comp = syms(r, "component1"); const copy = syms(r, "copy")
    if (!comp.length || !copy.length) throw new Error("phantoms missing (claim TRUE)")
  })
  await run("K22 import alias text", `import foo.Bar as Baz`, (r) => {
    console.log("   imports=" + JSON.stringify((r.imports ?? []).map((i: any) => ({ m: i.module, items: i.items, alias: i.metadata?.alias }))))
    const items = (r.imports ?? [])[0]?.items ?? []
    if (items.some((x: string) => x.includes("as "))) throw new Error("alias text leak (claim TRUE)")
  })
  await run("K23 variable inference", `class A {\n fun f() {\n var isReady = true\n }\n}`, (r) => {
    const kinds = [...new Set((r.symbols ?? []).map((s: any) => s.kind))]
    console.log("   kinds=" + JSON.stringify(kinds))
    // KAD-MR3 K23 ruling (M49.K1): local `var` symbols are intentionally NOT
    // emitted (family convention — java emits their TYPE references, not
    // Variable-kind symbols; locals are not project-symbol-table members).
    // The name-prefix "inference" that would have consumed them was DELETED
    // as dishonest (K6 ruling: isValid→Boolean guessing masquerading as
    // inference). Pin: no Variable kind may appear.
    const v = syms(r, "isReady")
    if (v.length) throw new Error("local var became a symbol (post-K6 pin)")
  })
  await run("K15 destructuring", `class A {\n val (a, b) = Pair(1, 2)\n}`, (r) => {
    const names = (r.symbols ?? []).map((s: any) => s.name)
    console.log("   names=" + JSON.stringify(names))
    if (names.some((n: string) => n.includes("(") || n.includes(","))) throw new Error("tuple symbol (claim TRUE)")
  })
  await run("K41 fq annotation", `import org.springframework.stereotype.Service\n@org.springframework.stereotype.Service\nclass S`, (r) => {
    const s = syms(r, "S")[0]
    console.log("   decorators=" + JSON.stringify(s?.decorators) + " meta_anns=" + JSON.stringify(s?.metadata?.annotations))
    if (!s?.metadata?.annotations?.includes("Service")) throw new Error("fq short name broken (claim TRUE)")
  })
  await run("K5 root rewrite scope", `val x: Foo = null\nclass Bar`, (r) => {
    console.log("   refs=" + JSON.stringify(rels(r, "references")))
    const bad = rels(r, "references").filter((x: any) => x.source === "Bar" && x.target === "Foo" && !x.metadata?.isImportDep)
    if (bad.length) throw new Error("top-level type ref rewritten to primary (claim TRUE)")
  })
  await run("K6 object primary", `import java.util.List\nobject Foo`, (r) => {
    console.log("   refs=" + JSON.stringify(rels(r, "references")))
    const imp = rels(r, "references").filter((x: any) => x.metadata?.isImportDep)
    if (imp.some((x: any) => x.source === "root")) throw new Error("import source stuck at root (claim TRUE)")
  })
  await run("K4 override sig", `open class B {\n open fun foo(x: Int): Int = x\n}\nclass S : B() {\n override fun foo(x: Int): Int = x\n}`, (r) => {
    const ov = rels(r, "overrides")
    console.log("   overrides=" + JSON.stringify(ov))
    // KAD-MR3 K4 ruling (M49.K1): family convention (scala/java) keeps
    // override sources as Owner.name -> Parent.name — the signature rides in
    // metadata.overrideSig (probe: "(Int)"), NOT in the source string.
    if (ov.length && ov[0].metadata?.overrideSig !== "(Int)") throw new Error("no sig payload (post-K2 pin)")
    if (ov.length && String(ov[0].source).includes("(")) throw new Error("sig leaked into source (family-convention violation)")
  })
  await run("K18 compose tier", `import androidx.compose.runtime.Composable\n@Composable\nfun Screen() {\n Text("hi")\n}`, (r) => {
    const cont = rels(r, "contains").filter((x: any) => x.metadata?.relationshipType === "compose_ui_tree")
    console.log("   compose=" + JSON.stringify(cont))
    if (cont.some((x: any) => x.metadata?.evidenceClass === "structural")) throw new Error("heuristic labeled structural (claim TRUE)")
  })
}
main()
