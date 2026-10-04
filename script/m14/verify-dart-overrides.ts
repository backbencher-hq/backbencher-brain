/**
 * verify-dart-overrides — the gate for the Dart `overrides` ORACLE.
 *
 * Fixtures pin the ANALYZER. Nothing pinned the oracle, and the oracle was where four
 * of the six defects behind Dart's 78 unexplained rows lived — so all of them were
 * invisible to a green suite and could have been reverted by any later change without
 * a single test turning red. This file is the missing half.
 *
 * Each case below is a shape, and each defect is recorded with the corpus row that
 * exposed it. The battery is deliberately written in the SHAPE the corpus contains,
 * never in the shape the rule talks about: the `const` constructor in
 * `dart-contains` was invisible to a battery written from a plain one because
 * `class D { D({int? x}); }` and `class A { const A({int? x}); }` are the same source
 * text modulo `const` and parse two different ways.
 *
 * Run: `bun run script/m14/verify-dart-overrides.ts`
 */

import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { deriveDartOverridesTruth } from "./oracles/dart-overrides"
import { deriveDartContainsTruth } from "./oracles/dart-contains"
import { RealDartAnalyzer } from "../../src/ast/real-dart-analyzer"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const WASM = path.join(ROOT, "wasm", "tree-sitter-dart.wasm")

type Case = {
  label: string
  src: string
  /** class name -> declared member names, standing in for the cross-repository index. */
  companion?: Map<string, Set<string>>
  /** project-wide exposure, when the case is about the index rather than the file. */
  expectTruth: string[]
  expectAnalyzer: string[]
  why: string
}

const M = (m: Record<string, string[]>): Map<string, Set<string>> =>
  new Map(Object.entries(m).map(([k, v]) => [k, new Set(v)]))

const CASES: Case[] = [
  {
    label: "static members are not overridable",
    src: `class HasStatic { const HasStatic(); static Future<HasStatic> connect(String u) async => HasStatic(); }
class Shadow extends HasStatic { static Future<Shadow> connect(String u) async => Shadow(); }`,
    companion: M({ HasStatic: ["connect"] }),
    expectTruth: [],
    expectAnalyzer: [],
    why: "Dart resolves a static call against the static type it was written on, so a subclass declaring the same static name shadows nothing. `@override` is not even legal on a static member. Published at 0.95 before the gate — measured on dart-http's BrowserWebSocket.connect -> WebSocket.connect, where BOTH sides were static.",
  },
  {
    label: "an annotated field overrides an inherited accessor",
    src: `abstract interface class ErrorState { String get message; }
final class PlainError implements ErrorState { @override final String message; const PlainError(this.message); }`,
    companion: M({ ErrorState: ["message"] }),
    expectTruth: ["PlainError.message->ErrorState.message"],
    expectAnalyzer: ["PlainError.message->ErrorState.message"],
    why: "A field implicitly provides a getter, and `@override` says it is shadowing one. Measured on MusicControlError.message -> ConnectionErrorState.message, where the interface lives in a different file. The oracle collected only signature wrappers, so it saw no member called `message` at all.",
  },
  {
    label: "a base field is a witness for an accessor override",
    src: `class Wallet { final String walletId; const Wallet(this.walletId); }
class WalletView implements Wallet { @override String get walletId => 'view'; }`,
    companion: M({ Wallet: ["walletId"] }),
    expectTruth: ["WalletView.walletId->Wallet.walletId"],
    expectAnalyzer: ["WalletView.walletId->Wallet.walletId"],
    why: "The base member is a FIELD and the subclass member is a GETTER. That is legal and it is the Wallet/_EmptyWallet case. The oracle excluded unannotated fields from the member set (python's class-variable defect) and so could not see the base declared anything.",
  },
  {
    label: "an instance field DOES override an inherited getter",
    src: `class Wallet { final String walletId; const Wallet(this.walletId); }
class Shadow extends Wallet { final String walletId = 'x'; }`,
    companion: M({ Wallet: ["walletId"] }),
    expectTruth: ["Shadow.walletId->Wallet.walletId"],
    expectAnalyzer: ["Shadow.walletId->Wallet.walletId"],
    why: "I wrote this case expecting NO edge, on the reasoning that a Dart field cannot be overridden by another field. That is right for STATIC members and wrong for instance ones, and the analyzer was right to publish it. Pinned because the wrong reasoning is what gets reintroduced.",
  },
  {
    label: "a static member does not make the NEXT member static",
    src: `class A { void first() {} void second() {} void third() {} }
class B extends A {
  static int helper = 0;
  @override void first() {}
  @override void second() {}
  @override void third() {}
}`,
    expectTruth: ["B.first->A.first", "B.second->A.second", "B.third->A.third"],
    expectAnalyzer: ["B.first->A.first", "B.second->A.second", "B.third->A.third"],
    why: "A gate that misidentifies its subject does not fail loudly, it stops COUNTING. The `isStatic` predicate walked to `previousNamedSibling` and read that node's children, so the first `static` member rendered every member after it static as well: measured on `CupertinoClient` in ok_http, where `static Future<...> _hasData` was followed by an ordinary `_createProfile`, the index held six of the class's eight methods and `CupertinoClientWithProfile._createProfile -> CupertinoClient._createProfile` was never derived. The cascade is silent — the count is the only thing anyone reads — so the predicate is now scoped to the member's OWN subtree and this case pins all three methods, not one.",
  },
  {
    label: "a static FIELD does not make the next field static",
    src: `class A { int one = 0; int two = 0; }
class B extends A {
  static int s = 0;
  @override int one = 1;
  @override int two = 2;
}`,
    expectTruth: ["B.one->A.one", "B.two->A.two"],
    expectAnalyzer: ["B.one->A.one", "B.two->A.two"],
    why: "The same cascade through `hasStaticToken`, which had the identical previous-sibling reach: a static field would hide every field after it. An instance field DOES override an inherited getter (see the case above), so losing these two would have been a fabrication in the other direction — the analyzer emits them and the oracle would not.",
  },
  {
    label: "breadth, not depth: a known base lacking the member is not the end",
    src: `class AlsoPlain { const AlsoPlain(); }
interface class HasPreferredSize { int get preferredSize; }
class BreadthFirst extends AlsoPlain implements HasPreferredSize { @override int get preferredSize => 72; }`,
    companion: M({ AlsoPlain: [], HasPreferredSize: ["preferredSize"] }),
    expectTruth: ["BreadthFirst.preferredSize->HasPreferredSize.preferredSize"],
    expectAnalyzer: ["BreadthFirst.preferredSize->HasPreferredSize.preferredSize"],
    why: "`AlsoPlain` is visited first, the companion knows it, and it declares nothing. The oracle had `break` where it needed `continue`, so `HasPreferredSize` was never considered. A flat companion map limits DEPTH — a known base's own bases are not in it — and says nothing about the other supertypes already in `direct`. Measured on SessionInfoHeader, where StatelessWidget precedes PreferredSizeWidget.",
  },
  {
    label: "extends and with share one clause",
    src: `class MixinBase { String describe() => 'base'; }
mixin Describe { String describe() => 'mixin'; }
class Both extends MixinBase with Describe { @override String describe() => 'both'; }`,
    expectTruth: ["Both.describe->MixinBase.describe"],
    expectAnalyzer: ["Both.describe->MixinBase.describe"],
    why: "The `with` list lives INSIDE the `superclass` node beside `extends`, not beside the declaration. Nearest-wins takes the `extends` base; the point is that the clause is read at all, since reading only direct children loses every `with` on a class that also extends something.",
  },
  {
    label: "a base this file proves lacks the member is refuted",
    src: `class PlainBase { const PlainBase(); }
class Real extends PlainBase { @override String build() => 'x'; }`,
    expectTruth: [],
    expectAnalyzer: [],
    why: "The file itself is the evidence. Claiming `Real.build -> PlainBase.build` is a fabrication, not a guess, and the refutation gate is what distinguishes the two — 101 such rows on ProxiCall/lib, all freezed `props`/`hashCode`/`toString` against Equatable.",
  },
  {
    label: "a genuinely external base still resolves",
    src: `class C extends Cubit { @override void close() {} }`,
    companion: M({ Cubit: ["close"] }),
    expectTruth: ["C.close->Cubit.close"],
    // The analyzer publishes this at 0.8 through its first-parent fallback, which is
    // a legitimate labelled claim: there is no evidence AGAINST it, only no evidence
    // for it. Asserting the analyzer publishes nothing here was my error when this
    // battery was written — a weaker-but-labelled claim is not a fabrication, and a
    // gate that refused everything would pass the refutation case and fail this one.
    expectAnalyzer: ["C.close->Cubit.close"],
    why: "The negative control for the gate above: `Cubit` is not in this file, so there is NO evidence against the claim and the fallback must still fire at its reduced confidence.",
  },
  {
    label: "an unannotated external member: oracle has evidence, analyzer does not here",
    src: `class C extends Cubit { void close() {} }`,
    companion: M({ Cubit: ["close"] }),
    // BOTH sides publish this, and that is the correction. I asserted the oracle
    // should claim nothing without `@override` — and the analyzer published it, so the
    // row read as a disagreement about a fact both sides agreed on. `@override` is
    // OPTIONAL in Dart (`annotate_overrides` is a lint), so a member of a class whose
    // base the companion knows DOES override, annotated or not. Measured on
    // `Request._checkFinalized -> BaseRequest._checkFinalized` in dart-http, which
    // carries no annotation at all.
    expectTruth: ["C.close->Cubit.close"],
    // The analyzer publishes NOTHING here, and that is correct: this battery gives it
    // no `projectIndex`, so it has no companion, and with no companion the only pass
    // left is the 0.8 first-parent fallback, which IS annotation-gated. The lane
    // supplies the index, and there the two agree. Asserting the analyzer publishes
    // this would be asserting a reach difference away, which is how the previous
    // version of this case came to demand the wrong thing from the oracle.
    expectAnalyzer: [],
    why: "The companion pass is NOT annotation-gated: a companion-verified match is evidence, not a guess. `@override` belongs to the FALLBACK only, where there is no evidence either way. I had the gate on the wrong pass, and the error was invisible because the case was asserted against the side that had less information.",
  },
  {
    label: "a generic supertype is still a supertype",
    src: `class C extends Cubit<S> { @override void close() {} }`,
    companion: M({ Cubit: ["close"] }),
    expectTruth: ["C.close->Cubit.close"],
    expectAnalyzer: ["C.close->Cubit.close"],
    why: "`Cubit<S>` carries a type argument, so a resolver that reads the superclass node as a single name can lose it. The alias rules are adjacent: `extends _i2.A2` parses as two SIBLING type_identifiers where the first is the import alias, so only the LAST in a group is the real type name.",
  },
  {
    label: "a three-deep in-file chain resolves transitively",
    src: `class A { void close() {} }
class B extends A {}
class C extends B { @override void close() {} }`,
    // B, NOT A. I wrote this expecting `C.close->A.close` — the base that DECLARES
    // `close` — and the analyzer produced exactly that, because without an index its
    // `declares()` looked for a symbol named `close` OWNED BY B and B has none. With a
    // project index the same file produced `C.close->B.close`, because the companion's
    // `allMembers` is inheritance-closed and B exposes `close`. Same code, two
    // answers, decided by the environment.
    //
    // B is right. The edge names the base whose INTERFACE the member replaces, and B
    // replaces A's `close` whether or not B re-declares it. The no-index answer was
    // "more precise about who wrote it" and less correct about what the edge means, and
    // it disagreed with the companion path on identical input. `declares()` is now
    // inheritance-closed so both paths ask the EXPOSER question, which is also what
    // `ProjectIndex.allMembers` computes and what the oracle reaches independently.
    expectTruth: ["C.close->B.close"],
    expectAnalyzer: ["C.close->B.close"],
    why: "The walk passes through an intermediate that DECLARES nothing but EXPOSES the member, and the edge belongs to the intermediate. This is the in-file twin of the breadth case, and the case that proved the two resolution paths could disagree on the same file.",
  },
  {
    label: "containment: a const constructor is a member",
    src: `class A { const A({int? x}); }`,
    expectTruth: ["A->constructor"],
    expectAnalyzer: ["A->constructor"],
    why: "Not an overrides case, but the same failure mode as the overrides ones and it belongs in the same battery. `class D { D({int? x}); }` is the SAME SOURCE TEXT as `class A { const A({int? x}); }` and parses as the plain `constructor_signature` spelling, so a battery written from the plain form passes while the corpus fails. Measured: 2,548 rows, and most of a Flutter widget class.",
  },
]

async function main(): Promise<void> {
  const wts: any = WTS
  const Parser: any = wts.Parser ?? wts.default ?? wts
  const Language: any = wts.Language ?? wts.default?.Language
  await Parser.init()
  const lang = await Language.load(fs.readFileSync(WASM))
  const parser = new Parser()
  parser.setLanguage(lang)

  let failures = 0
  for (const c of CASES) {
    const p1 = new Parser()
    p1.setLanguage(lang)
    const p2 = new Parser()
    p2.setLanguage(lang)
    const t1 = p1.parse(c.src)
    const t2 = p2.parse(c.src)

    const derived = [...new Set(deriveDartOverridesTruth(t1.rootNode, c.companion).map((e) => `${e.from}->${e.target}`))]
    const contains = [...new Set(deriveDartContainsTruth(t1.rootNode).map((e) => `${e.from}->${e.target}`))]
    const truth = c.label.startsWith("containment") ? contains : derived

    const r: any = await new RealDartAnalyzer().analyze(t2.rootNode, c.src, "/tmp/verify-dart-overrides.dart")
    const label = c.label.startsWith("containment") ? "contains" : "overrides"
    const got: string[] = [...new Set<string>((r.relationships ?? []).filter((e: any) => e.type === label).map((e: any) => `${e.source}->${e.target}`))].sort()

    const problems: string[] = []
    for (const want of c.expectTruth) if (!truth.includes(want)) problems.push(`truth missing ${want}; got [${truth.join(" ")}]`)
    for (const wrong of truth) if (!c.expectTruth.includes(wrong)) problems.push(`truth has UNEXPECTED ${wrong}`)
    for (const want of c.expectAnalyzer) if (!got.includes(want)) problems.push(`analyzer missing ${want}; got [${got.join(" ")}]`)
    for (const wrong of got) if (!c.expectAnalyzer.includes(wrong)) problems.push(`analyzer has UNEXPECTED ${wrong}`)

    // The analyzer is not expected to see a cross-repository companion, so a case
    // whose truth needs one is allowed to diverge there. Record that explicitly
    // rather than letting the battery imply the two were compared on equal footing.

    if (problems.length === 0) {
      console.log(`ok   ${c.label}`)
    } else {
      failures++
      console.log(`FAIL ${c.label}`)
      for (const p of problems) console.log(`       ${p}`)
    }
    try { t1.delete(); t2.delete() } catch { /* an aborted instance refuses politely */ }
  }

  console.log(`\nverify-dart-overrides: ${CASES.length - failures}/${CASES.length} shapes exact`)
  if (failures > 0) {
    console.log(`${failures} shape(s) disagreed`)
    process.exit(1)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
