/**
 * PY-IMPL — the construct probe that decides `implements` for the python lane.
 *
 * ## The question
 *
 * `implements` is the ONE of the ten types this analyzer does not emit. Per the
 * ontology workstream a verdict is EMITTED (measured emission), RULED (a written
 * reason AND a corpus measurement proving the construct never occurs), or GAP (the
 * language has the construct and the analyzer is not reading it). A ruling needs the
 * measurement, so this file is the measurement.
 *
 * ## Why a probe and not the analyzer
 *
 * The analyzer emits `extends` for every base-class entry. The question is whether
 * any of those entries means something OTHER than inheritance, so the answer cannot
 * come from the analyzer's own output — that would be the analyzer agreeing with
 * itself. This walks the raw tree-sitter tree of every corpus file, independently,
 * reading `node.type` and named children only.
 *
 * ## No regex
 *
 * Not one. Every counter below is a node-type test plus a named-child read. A text
 * probe is the specific instrument the ontology gate's first version used to return
 * two false positives (a probe for `extends` matched `class voice` inside a telnet
 * IAC word list in a bash string literal), so it is not used here.
 *
 * ## Calibration — a zero from an uncalibrated probe is not evidence
 *
 * The julia ruling records the trap: "instrument B falsifies only on a NON-ZERO
 * count, so a broken probe would have made the gate report RULED-SOUND for the wrong
 * reason." Every counter here is therefore exercised against a synthetic source that
 * contains every shape it claims to detect, and `selfTest()` FAILS LOUDLY if any
 * counter reads zero on it. The corpus numbers are only trustworthy if the
 * instrument is trusted first.
 *
 * ## What counts as the construct
 *
 * Python spells inheritance and interface conformance IDENTICALLY — both are an entry
 * in the `class X(...)` base list — so there is no second clause to read. The
 * distinction, if it exists, is a property of the BASE: a base that is an abstract
 * base class or a structural protocol is an interface, and naming it is arguably
 * "implementing" it. So the probe counts those bases rather than assuming them, and
 * counts the one construct Python has that is conformance WITHOUT inheritance:
 * `SomeABC.register(SomeClass)`, which makes `issubclass` true with no base-list
 * entry at all.
 *
 * Usage:
 *   bun run validation/m14/fixtures/python/implements-probe.ts --self-test
 *   bun run validation/m14/fixtures/python/implements-probe.ts --json
 *   bun run validation/m14/fixtures/python/implements-probe.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import * as wts from "web-tree-sitter"

// validation/m14/fixtures/python/ -> repo root is FOUR levels up, not three.
const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
// The corpus directory. Defaults to the aggregated `python-corpus/` (the layout the ruling
// numbers were measured on), but honours `BB_PY_CORPUS` — the same env var
// `script/m14/python-construct-census.mts` uses — so the probe also runs on a box whose corpus
// is FLAT (each repo a top-level directory under the root). Measured from either layout the
// population is `git ls-files` per top-level checkout, so the two runs count the same CLASS of
// file, and the artefact records which root it walked rather than leaving it to memory.
const PY_CORPUS = process.env.BB_PY_CORPUS ?? path.join(CR, "python-corpus")

await wts.Parser.init({
  locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const parser = new wts.Parser()
parser.setLanguage(await wts.Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-python.wasm"))))

/**
 * Node types that would EXPRESS a conformance relation distinct from a supertype
 * clause. This is instrument A: the question is whether python's grammar has a node
 * for it at all, and the only sound answer is an enumeration of what the grammar
 * actually produces. Carried so the gate can falsify the ruling if the grammar ever
 * grows one.
 */
const WOULD_MEAN_IMPLEMENTS = [
  "implements_clause",
  "implements_list",
  "implements_specifier",
  "implements_declaration",
  "interface_implementation",
  "interface_specifier",
  "interface_declaration",
  "protocol_declaration",
  "protocol_conformance",
  "conformance_clause",
  "super_interfaces",
  "abstract_class_declaration",
  "type_declaration_list",
  "base_class_clause",
  "type_inheritance_clause",
  "mixin_clause",
  "conform_clause",
]

type Counter = { occurrences: number; samples: string[] }
const newCounter = (): Counter => ({ occurrences: 0, samples: [] })

const COUNTERS = {
  /** A base-list entry naming an ABC: `class C(ABC)` / `class C(abc.ABC)`. */
  abcBase: newCounter(),
  /** ...spelled QUALIFIED (`abc.ABC`, `abc.ABCMeta`) — proof the base is abc's, not a local namesake. */
  abcBaseQualified: newCounter(),
  /** ...bound by `from abc import ABC` in the SAME file. */
  abcBaseImported: newCounter(),
  /** A base-list entry naming a Protocol: `class C(Protocol)` / `class C(typing.Protocol)`. */
  protocolBase: newCounter(),
  protocolBaseQualified: newCounter(),
  protocolBaseImported: newCounter(),
  /** A method decorated `@abstractmethod` — the interface's required member. */
  abstractmethod: newCounter(),
  abstractmethodImported: newCounter(),
  /**
   * EVERY `.register(` call, however it is spelled. This is the LOOSE count and it is
   * kept deliberately: the tight count below is derived from it, and a tightening that
   * cannot be seen shrinking the population is a tightening nobody can check.
   */
  registerCallLoose: newCounter(),
  /**
   * The one construct python has that is conformance WITHOUT inheritance:
   * `SomeABC.register(SomeConcrete)` makes `issubclass` true with no base-list entry.
   *
   * TIGHT on purpose. The loose count is dominated by plugin registries — ansible's own
   * `LocalManager.register`, `super().register` — which are object registration, not
   * type conformance. A receiver counts here only if it is a bare identifier naming an
   * abc registry: a class declared IN THIS FILE whose bases include ABC/ABCMeta/
   * Protocol, or a name this file bound to `abc.ABCMeta`/`abc.ABC`.
   */
  virtualRegister: newCounter(),
  /** `@implementer(IFoo)` — zope.interface, the one python library spelling "implements". */
  implementerDecorated: newCounter(),
  /** Total base-list entries seen, so every ratio below has a denominator. */
  baseEntries: newCounter(),
  /** Total class declarations seen. */
  classDefs: newCounter(),
  /**
   * A KEYWORD ARGUMENT in a CLASS HEADER — `class C(metaclass=ABCMeta)`, `class T(TypedDict,
   * total=False)`. Python's spelling of the ATTRIBUTE-KEYS space, the space HCL hid `inherits`
   * in: a construct carried by a `key=value` binding rather than by a node type of its own, which
   * is why the ontology gate refuses a node-type-only ruling in a language that writes them.
   * Counted even when the value names no interface (`total=False`), because the claim is about
   * what the probe looked at, not about what it found.
   */
  classHeaderKeywordArguments: newCounter(),
  /**
   * Every `keyword_argument` NODE in the corpus, wherever it occurs — the probe's own reading of
   * the attribute-keys space, at corpus scale rather than at class-header scale. The gate
   * measures the same space its own way (801,877 nodes with a `=` or `:` between two named
   * children over 11,488 files, of which `keyword_argument` is 227,905); this is the tree-side
   * count of the node python uses to spell a key/value binding.
   */
  keywordArgumentNodes: newCounter(),
  /**
   * ...and the subset that DECLARES AN INTERFACE: `metaclass=ABCMeta` / `metaclass=abc.ABCMeta`,
   * provably abc's. `real-python-analyzer.ts` keys on exactly this (`if (kn === "metaclass")`),
   * so a class whose header declares an interface this way is an interface that inherits
   * nothing — the one interface spelling no base-list entry can carry.
   */
  metaclassArg: newCounter(),
}

/**
 * Which FILES each counter fired in. Kept out of `COUNTERS` because that object is
 * serialised to the JSON report, and a Set of paths in a report is noise.
 *
 * The first version of this probe incremented only `occurrences` and left `files` at 0
 * on every row — so it printed `14 occurrences in 0 files`, a number that is
 * self-evidently wrong and which a reader skimming past would not catch. The honesty
 * contract requires an instrument to declare the population it covered, and a file
 * count of zero is a population declaration that says nothing.
 */
const COUNTER_FILES = new Map<string, Set<string>>()
for (const k of Object.keys(COUNTERS)) COUNTER_FILES.set(k, new Set())

/** The live counter set, reset for the self test and restored after it. */
let ACTIVE: Record<string, Counter> = COUNTERS
let ACTIVE_FILES: Map<string, Set<string>> = COUNTER_FILES

const bump = (key: string, label: string, file: string): void => {
  const c = ACTIVE[key]
  if (c.samples.length < 4) c.samples.push(`${file}: ${label}`)
  c.occurrences++
  ACTIVE_FILES.get(key)?.add(file)
}

/** names bound by `from MODULE import NAME`, as `boundName -> "MODULE.NAME"` — read off the tree. */
function importedNames(root: any): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (n: any): void => {
    if (n.type === "import_from_statement") {
      // The grammar emits the module as the FIRST named child (`dotted_name`, or
      // `relative_import` for `from . import x`) and every imported name after it.
      // There is no need to look for the `import` keyword: it is ANONYMOUS, so it is
      // not among namedChildren at all.
      //
      // The first version of this function did look for it, and read every counter
      // bound to it as zero — `abcBaseImported`, `protocolBaseImported` and
      // `abstractmethodImported` all returned 0 on a source containing exactly those
      // imports. `selfTest()` caught it, which is the entire reason it exists: a probe
      // that silently finds nothing would have reported "python's corpus contains no
      // imported ABC bases", which is a ruling, and it would have been wrong.
      let module = ""
      let names: Array<{ name: string; alias?: string }> = []
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c || c.type === "wildcard_import") continue
        if (module.length === 0 && (c.type === "dotted_name" || c.type === "relative_import")) {
          module = c.text
          continue
        }
        if (c.type === "identifier") names.push({ name: c.text })
        else if (c.type === "aliased_import") {
          const nm = c.childForFieldName?.("name") || c.namedChild(0)
          const al = c.childForFieldName?.("alias") || c.namedChild(1)
          if (nm) names.push({ name: nm.text, alias: al ? al.text : undefined })
        } else if (c.type === "dotted_name") names.push({ name: c.text })
      }
      for (const { name, alias } of names) out.set(alias ?? name, module.length ? `${module}.${name}` : name)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c)
    }
  }
  walk(root)
  return out
}

/** The leaf name of a base-list entry, and whether it was spelled QUALIFIED. */
function baseLeaf(node: any): { leaf: string; qualified: boolean } | null {
  if (node.type === "identifier") return { leaf: node.text, qualified: false }
  if (node.type === "attribute") {
    const last = node.namedChild(node.namedChildCount - 1)
    return last ? { leaf: last.text, qualified: true } : null
  }
  if (node.type === "subscript") {
    const first = node.namedChild(0)
    return first ? baseLeaf(first) : null
  }
  return null
}

function measure(root: any, file: string): void {
  const bound = importedNames(root)
  const abcBound = (name: string): boolean => {
    const full = bound.get(name)
    return full !== undefined && (full === "abc.ABC" || full === "abc.ABCMeta")
  }
  const protoBound = (name: string): boolean => {
    const full = bound.get(name)
    return full !== undefined && (full === "typing.Protocol" || full === "typing_extensions.Protocol")
  }
  const abstractBound = (name: string): boolean => {
    const full = bound.get(name)
    return full !== undefined && (full === "abc.abstractmethod" || full === "abc.abstractproperty")
  }

  // Pass one: the class declarations this file makes, and which of them are abc registries.
  // The tight `register` count needs this BEFORE the call pass, because whether
  // `MyABC.register(X)` is conformance or plugin bookkeeping is decided by what `MyABC`
  // IS — and a single-pass walk cannot know that when it reaches the call.
  const registries = new Set<string>()
  const classesWithAbcBase = new Map<string, boolean>()
  {
    const visit = (n: any): void => {
      if (n.type === "class_definition") {
        let cname: string | undefined
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "identifier") {
            cname = c.text
            break
          }
        }
        let hasAbcBase = false
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c.type !== "argument_list") continue
          for (let j = 0; j < c.namedChildCount; j++) {
            const arg = c.namedChild(j)
            if (!arg || arg.type === "keyword_argument") continue
            const bl = baseLeaf(arg)
            if (!bl) continue
            if ((bl.leaf === "ABC" || bl.leaf === "ABCMeta") && (bl.qualified || abcBound(bl.leaf))) hasAbcBase = true
            if (bl.leaf === "Protocol" && (bl.qualified || protoBound(bl.leaf))) hasAbcBase = true
          }
        }
        if (cname) {
          classesWithAbcBase.set(cname, hasAbcBase)
          if (hasAbcBase) registries.add(cname)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c)
      }
    }
    visit(root)
  }
  // A name this file bound to abc's own ABC/ABCMeta is a registry too.
  for (const [name, full] of bound) {
    if (full === "abc.ABCMeta" || full === "abc.ABC") registries.add(name)
  }
  // `abc.ABCMeta.register(X)` — qualified, so the receiver is an `attribute` whose
  // object is the `abc` import. Named explicitly rather than guessed by leaf.
  let abcModuleBound = false
  for (const full of bound.values()) if (full.startsWith("abc.")) abcModuleBound = true
  {
    const visit = (n: any): void => {
      if (n.type === "import_statement") {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && (c.type === "dotted_name" || c.type === "aliased_import")) {
            const txt = c.type === "dotted_name" ? c.text : (c.childForFieldName?.("name") || c.namedChild(0))?.text ?? ""
            if (txt === "abc" || txt.startsWith("abc.")) abcModuleBound = true
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c)
      }
    }
    visit(root)
  }

  const walk = (n: any): void => {
    if (n.type === "class_definition") {
      bump("classDefs", "class", file)
      let args: any = null
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "argument_list") {
          args = c
          break
        }
      }
      if (args) {
        for (let i = 0; i < args.namedChildCount; i++) {
          const arg = args.namedChild(i)
          if (!arg) continue
          if (arg.type === "keyword_argument") {
            // The ATTRIBUTE-KEYS space (see COUNTERS). `metaclass=` is the only keyword that can
            // declare an interface without naming a base, and it is proven the same way a base
            // is: the value is `abc.ABCMeta` qualified, or a bare `ABCMeta` this file bound to
            // abc. A local class that happens to be called `ABCMeta` is a name coincidence, not
            // a metaclass, and is not counted.
            const key = arg.namedChild(0)
            const val = arg.namedChild(arg.namedChildCount - 1)
            bump("classHeaderKeywordArguments", `${key?.text ?? "?"}=`, file)
            if (key?.text === "metaclass" && val) {
              const vl = baseLeaf(val)
              const qualifiedAbc = val.type === "attribute" && val.namedChild(0)?.text === "abc"
              if (vl && vl.leaf === "ABCMeta" && (qualifiedAbc || abcBound(vl.leaf))) {
                bump("metaclassArg", "metaclass=ABCMeta", file)
              }
            }
            continue
          }
          const bl = baseLeaf(arg)
          if (!bl) continue
          bump("baseEntries", bl.leaf, file)
          const label = `${bl.leaf}`
          if (bl.leaf === "ABC" || bl.leaf === "ABCMeta") {
            bump("abcBase", label, file)
            if (bl.qualified && arg.type === "attribute") {
              // `abc.ABC` — the qualifier is read off the tree, not the text.
              const obj = arg.namedChild(0)
              if (obj && obj.type === "identifier" && obj.text === "abc") bump("abcBaseQualified", `${obj.text}.${bl.leaf}`, file)
            }
            if (abcBound(bl.leaf)) bump("abcBaseImported", `from abc import ${bl.leaf}`, file)
          }
          if (bl.leaf === "Protocol") {
            bump("protocolBase", label, file)
            if (bl.qualified && arg.type === "attribute") {
              const obj = arg.namedChild(0)
              if (obj && obj.type === "identifier" && (obj.text === "typing" || obj.text === "typing_extensions")) {
                bump("protocolBaseQualified", `${obj.text}.Protocol`, file)
              }
            }
            if (protoBound(bl.leaf)) bump("protocolBaseImported", `from typing import Protocol`, file)
          }
        }
      }
    }
    // `@abstractmethod` on a def.
    if (n.type === "decorator") {
      const inner = n.namedChild(0)
      let leaf: string | undefined
      if (inner) {
        if (inner.type === "identifier") leaf = inner.text
        else if (inner.type === "attribute") {
          const last = inner.namedChild(inner.namedChildCount - 1)
          leaf = last ? last.text : undefined
        } else if (inner.type === "call") {
          const fn = inner.namedChild(0)
          if (fn) {
            if (fn.type === "identifier") leaf = fn.text
            else if (fn.type === "attribute") {
              const last = fn.namedChild(fn.namedChildCount - 1)
              leaf = last ? last.text : undefined
            }
          }
        }
      }
      const isMethodDecoratedDef =
        n.parent?.type === "decorated_definition" &&
        (() => {
          for (let i = 0; i < n.parent.namedChildCount; i++) {
            const c = n.parent.namedChild(i)
            if (c && c.type === "function_definition") return true
          }
          return false
        })()
      if (leaf === "abstractmethod" && isMethodDecoratedDef) {
        bump("abstractmethod", "@abstractmethod", file)
        if (abstractBound(leaf)) bump("abstractmethodImported", "from abc import abstractmethod", file)
      }
      if (leaf === "implementer" || leaf === "implementer_only") {
        bump("implementerDecorated", `@${leaf}`, file)
      }
    }
    // `SomeABC.register(SomeClass)` — conformance with no base-list entry at all.
    if (n.type === "call") {
      const fn = n.namedChild(0)
      if (fn && fn.type === "attribute") {
        const last = fn.namedChild(fn.namedChildCount - 1)
        if (last && last.text === "register") {
          bump("registerCallLoose", fn.text, file)
          const obj = fn.namedChild(0)
          let isConformance = false
          if (obj && obj.type === "identifier") {
            // `MyABC.register(X)` where MyABC is an abc registry THIS FILE can prove.
            if (registries.has(obj.text)) isConformance = true
          } else if (obj && obj.type === "attribute") {
            // `abc.ABCMeta.register(X)` — the module itself is the registry.
            const objLeaf = obj.namedChild(obj.namedChildCount - 1)
            if (abcModuleBound && objLeaf && objLeaf.text === "ABCMeta") isConformance = true
          }
          if (isConformance) bump("virtualRegister", fn.text, file)
        }
      }
    }
    // THE ATTRIBUTE-KEYS SPACE, counted where it actually occurs: every `keyword_argument` node in
    // the corpus, not only the ones in a class header. The ruling that needs this space declared
    // is about a language that spells constructs as key/value bindings, so the evidence has to be
    // a corpus-scale count of that spelling — a class-header-only number would be a token that
    // verifies without saying anything.
    if (n.type === "keyword_argument") bump("keywordArgumentNodes", "keyword_argument", file)
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c)
    }
  }
  walk(root)
}

// ---------------------------------------------------------------- population
//
// DERIVED from the disk, never hand-written. A hand-written `FILES = [...]` rots the
// moment a file is added beside it and then reports a stale number with total
// confidence (docs/M14-HONESTY-CONTRACT.md, "Rule: an instrument must declare the
// population it covered").

function isCheckout(dir: string): boolean {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function discover(): { name: string; dir: string; files: string[] }[] {
  const out: { name: string; dir: string; files: string[] }[] = []
  let names: string[]
  try {
    names = readdirSync(PY_CORPUS).sort()
  } catch {
    return out
  }
  for (const name of names) {
    const dir = path.join(PY_CORPUS, name)
    try {
      if (!statSync(dir).isDirectory() || !isCheckout(dir)) continue
    } catch {
      continue
    }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    const files = tracked
      .filter((f) => f.endsWith(".py") || f.endsWith(".pyi"))
      .map((f) => path.join(dir, f))
      .filter((f) => {
        try {
          return statSync(f).size > 0 && statSync(f).size <= 512 * 1024
        } catch {
          return false
        }
      })
    if (files.length) out.push({ name, dir, files })
  }
  return out
}

// ---------------------------------------------------------------- self test

const SELFTEST_SOURCE = `
import abc
import typing
import typing as t
from abc import ABC, ABCMeta, abstractmethod
from typing import Protocol


class Q1(ABC):
    @abstractmethod
    def go(self): ...


class Q2(abc.ABC):
    @abc.abstractmethod
    def stop(self): ...


class Q3(ABCMeta):
    pass


class Q4(typing.Protocol):
    x: int


class Q5(t.Protocol):
    y: int


class Q6(Protocol):
    z: int


class Unrelated:
    def register(self, other): ...


Q6.register(Q1)


class Q8(ABC):
    pass


class KEYWORD_ARG_INTERFACE(metaclass=abc.ABCMeta):
    pass


# A class-header keyword argument that is NOT an interface: it must be counted in the SPACE
# counter and refused by the metaclass counter, which is why both exist.
class KEYWORD_ARG_NOT_INTERFACE(object, metaclass=type):
    pass


Q8.register(Q1)


abc.ABCMeta.register(Q1)


# NOT conformance: plugin registries that happen to have a register method. The
# tight counter must NOT count these, while the loose one must — that difference is
# the entire justification for having two counters.
LocalManager = object()
LocalManager.register(Q1)


self.register(Q1)


super().register(Q1)


@abc.abstractmethod
def loose_abc():
    ...


# Two keyword arguments in ordinary CALL position, so the corpus-scale space counter and the
# class-header counter cannot be the same number by construction.
calibrate(alpha=1, beta=2)
`

/**
 * Counters that must be NON-ZERO on `SELFTEST_SOURCE`, which contains every shape.
 *
 * `registerCallLoose` is asserted at EXACTLY 6 and `virtualRegister` at exactly 3, not
 * merely "> 0". The self-test source deliberately contains six `.register(` calls of
 * which only three are type conformance: `Q6.register` (Protocol-derived), and
 * `Q8.register` (ABC-derived) and `abc.ABCMeta.register` are conformance, while
 * `LocalManager.register`, `self.register` and `super().register` are not. If both
 * counters read the same number the tight filter is not filtering, and a "0
 * conformance-registrations" corpus reading would then mean the probe is broken rather
 * than that python does not do it.
 */
const SELFTEST_EXPECT_NONZERO = [
  "abcBase",
  "abcBaseQualified",
  "abcBaseImported",
  "protocolBase",
  "protocolBaseQualified",
  "protocolBaseImported",
  "abstractmethod",
  "abstractmethodImported",
  "registerCallLoose",
  "virtualRegister",
  "baseEntries",
  "classDefs",
  "classHeaderKeywordArguments",
  "keywordArgumentNodes",
  "metaclassArg",
]

/** Exact counts the self-test source is built to produce, when the probe is correct. */
const SELFTEST_EXACT: Record<string, number> = {
  registerCallLoose: 6,
  virtualRegister: 3,
  // Two class-header keyword arguments are written (`metaclass=abc.ABCMeta`,
  // `metaclass=type`) and exactly ONE of them declares an interface. Asserted exactly so that
  // a metaclass counter that counts every keyword argument cannot pass as a filter.
  classHeaderKeywordArguments: 2,
  metaclassArg: 1,
  // ...and FOUR keyword-argument nodes in total (the two class headers plus `calibrate(alpha=1,
  // beta=2)`), so the corpus-scale space counter is proven to see the ones outside a header.
  keywordArgumentNodes: 4,
}

function selfTest(): { ok: boolean; rows: [string, number, number][] } {
  const savedCounters = ACTIVE
  const savedFiles = ACTIVE_FILES
  ACTIVE = Object.fromEntries(Object.keys(COUNTERS).map((k) => [k, newCounter()])) as Record<string, Counter>
  ACTIVE_FILES = new Map(Object.keys(COUNTERS).map((k) => [k, new Set<string>()]))
  const tree = parser.parse(SELFTEST_SOURCE)
  measure(tree.rootNode, "SELFTEST")
  const rows: [string, number, number][] = SELFTEST_EXPECT_NONZERO.map((k) => [
    k,
    ACTIVE[k].occurrences,
    ACTIVE_FILES.get(k)?.size ?? 0,
  ])
  // `implementerDecorated` is expected ZERO here: it needs zope.interface, which this
  // synthetic source deliberately does not import. A non-zero reading would mean the
  // probe matches a shape it must not, so it is asserted rather than merely reported.
  const imp = ACTIVE.implementerDecorated
  rows.push(["implementerDecorated(EXPECT 0)", imp.occurrences, imp.samples.length])
  const ok =
    SELFTEST_EXPECT_NONZERO.every((k) => ACTIVE[k].occurrences > 0) &&
    imp.occurrences === 0 &&
    Object.entries(SELFTEST_EXACT).every(([k, want]) => ACTIVE[k].occurrences === want)
  ACTIVE = savedCounters
  ACTIVE_FILES = savedFiles
  return { ok, rows }
}

// ---------------------------------------------------------------- run

const JSON_OUT = process.argv.includes("--json")
const SELFTEST_ONLY = process.argv.includes("--self-test")

// The grammar inventory is taken from the CORPUS walk, not from this file's own idea
// of python, so it is instrument A in the sense the gate means: what the grammar
// actually produces across the corpus.
const nodeTypes = new Map<string, number>()
const self = selfTest()

/** Population of directories under the corpus root that are NOT git checkouts. */
function unpinnedDirs(): { name: string; files: string[] }[] {
  const out: { name: string; files: string[] }[] = []
  let names: string[]
  try {
    names = readdirSync(PY_CORPUS).sort()
  } catch {
    return out
  }
  for (const name of names) {
    const dir = path.join(PY_CORPUS, name)
    try {
      if (!statSync(dir).isDirectory() || isCheckout(dir)) continue
    } catch {
      continue
    }
    const files: string[] = []
    const walk = (d: string): void => {
      let ents
      try {
        ents = readdirSync(d, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of ents) {
        if (e.name === ".git") continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) {
          walk(p)
          continue
        }
        if (e.name.endsWith(".py") || e.name.endsWith(".pyi")) {
          try {
            if (statSync(p).size > 0 && statSync(p).size <= 512 * 1024) files.push(p)
          } catch {
            /* unreadable: not part of the population */
          }
        }
      }
    }
    walk(dir)
    if (files.length) out.push({ name, files })
  }
  return out
}

const UNPINNED = unpinnedDirs()
/** Counters for the unpinned population, measured separately and never merged in. */
let unpinnedReport: Record<string, { occurrences: number; files: number }> = {}

if (!SELFTEST_ONLY) {
  const repos = discover()
  let parsed = 0
  let failed = 0
  const perRepo: Record<string, number> = {}
  for (const r of repos) {
    for (const f of r.files) {
      let text: string
      try {
        text = readFileSync(f, "utf8")
      } catch {
        failed++
        continue
      }
      let tree: any
      try {
        tree = parser.parse(text)
      } catch {
        failed++
        continue
      }
      if (!tree) {
        failed++
        continue
      }
      parsed++
      perRepo[r.name] = (perRepo[r.name] ?? 0) + 1
      measure(tree.rootNode, path.relative(PY_CORPUS, f))
      const v = (n: any): void => {
        nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
        for (let i = 0; i < n.childCount; i++) v(n.child(i))
      }
      v(tree.rootNode)
      tree.delete?.()
    }
  }
  // The UNPINNED population — `python-corpus/cpython-stdlib` is CPython's own stdlib
  // with no `.git`, and `abc`/`typing`/`enum` are exactly where python's interface
  // constructs are DEFINED. Excluding it silently would make the ruling's population
  // the wrong one, so it is measured on its own counters and printed separately.
  {
    const savedC = ACTIVE
    const savedF = ACTIVE_FILES
    ACTIVE = Object.fromEntries(Object.keys(COUNTERS).map((k) => [k, newCounter()])) as Record<string, Counter>
    ACTIVE_FILES = new Map(Object.keys(COUNTERS).map((k) => [k, new Set<string>()]))
    for (const d of UNPINNED) {
      for (const f of d.files) {
        let tree: any
        try {
          tree = parser.parse(readFileSync(f, "utf8"))
        } catch {
          continue
        }
        if (!tree) continue
        measure(tree.rootNode, `${d.name}/${path.basename(f)}`)
        const v = (n: any): void => {
          nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
          for (let i = 0; i < n.childCount; i++) v(n.child(i))
        }
        v(tree.rootNode)
        tree.delete?.()
      }
    }
    unpinnedReport = Object.fromEntries(
      Object.keys(COUNTERS).map((k) => [
        k,
        { occurrences: ACTIVE[k].occurrences, files: ACTIVE_FILES.get(k)?.size ?? 0 },
      ]),
    )
    ACTIVE = savedC
    ACTIVE_FILES = savedF
  }
  report(parsed, failed, perRepo, nodeTypes)
} else {
  reportSelf()
}

function reportSelf(): void {
  console.log("implements probe — SELF TEST (calibration)")
  console.log(`A counter that reads 0 on a source that contains the shape is a BROKEN probe.`)
  console.log(`result: ${self.ok ? "every asserted counter fired" : "FAILED — a counter did not fire"}\n`)
  console.log(`  ${"counter".padEnd(34)} ${"occurrences".padStart(11)}  files`)
  for (const [k, n, f] of self.rows) console.log(`  ${k.padEnd(34)} ${String(n).padStart(11)}  ${f}`)
  if (!self.ok) process.exit(1)
}

function report(parsed: number, failed: number, perRepo: Record<string, number>, nts: Map<string, number>): void {
  const present = WOULD_MEAN_IMPLEMENTS.filter((n) => nts.has(n))
  const pinned = Object.values(perRepo).reduce((a, b) => a + b, 0)
  const unpinnedTotal = UNPINNED.reduce((a, u) => a + u.files.length, 0)
  const out = {
    corpusRoot: PY_CORPUS,
    populationPinned: pinned,
    perRepo,
    populationUnpinned: UNPINNED.map((u) => ({ name: u.name, files: u.files.length })),
    populationUnpinnedTotal: unpinnedTotal,
    parsed,
    failed,
    selfTest: { ok: self.ok, rows: self.rows },
    grammarNodeTypesObserved: nts.size,
    wouldMeanImplements: {
      candidates: WOULD_MEAN_IMPLEMENTS,
      present,
      absent: WOULD_MEAN_IMPLEMENTS.filter((n) => !nts.has(n)),
    },
    // THE GATE'S NUMBER — one count of every construct site that would produce an `implements`
    // edge: the base-list spellings an interface DECLARATION or conformance uses (`abcBase` +
    // `protocolBase`), the tier-3 virtual registration (`virtualRegister`), and the metaclass
    // keyword spelling that declares an interface for a later subclass to satisfy
    // (`metaclassArg`). The components stay published above, so this sum is checkable and a zero
    // here cannot hide a non-zero component. The definition is restated in the string below
    // because a JSON artefact has nowhere else to say what its number means.
    implementsConstructSites:
      COUNTERS.abcBase.occurrences +
      COUNTERS.protocolBase.occurrences +
      COUNTERS.virtualRegister.occurrences +
      COUNTERS.metaclassArg.occurrences,
    implementsConstructSitesDefinition:
      "abcBase + protocolBase + virtualRegister + metaclassArg — every site in the walked " +
      "population where python DECLARES or SATISFIES an interface: a base-list entry naming an " +
      "abc ABC/ABCMeta or a typing/typing_extensions Protocol, a proven ABC.register(X) virtual " +
      "registration, and a class whose header declares an abc metaclass. The analyzer publishes " +
      "each of the first three as an `implements` edge (PY-34: the most specific true label, one " +
      "edge per base); the metaclass spelling declares the interface those edges point AT.",
    counters: Object.fromEntries(
      Object.keys(COUNTERS).map((k) => [
        k,
        { occurrences: COUNTERS[k].occurrences, files: COUNTER_FILES.get(k)?.size ?? 0, samples: COUNTERS[k].samples },
      ]),
    ),
    countersUnpinned: unpinnedReport,
  }
  if (JSON_OUT) {
    console.log(JSON.stringify(out, null, 1))
    return
  }
  console.log(`implements construct probe — python`)
  console.log(`corpus: ${PY_CORPUS}`)
  console.log(
    `POPULATION (pinned): ${pinned} parsed .py/.pyi from ${Object.keys(perRepo).length} checkouts (${Object.entries(perRepo)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")})  unread ${failed}`,
  )
  console.log(
    `POPULATION (unpinned, measured SEPARATELY and never merged): ${unpinnedTotal} files (${UNPINNED.map((u) => `${u.name}=${u.files.length}`).join(" ")})`,
  )
  console.log(`SELF TEST:  ${self.ok ? "PASS" : "FAIL"}`)
  for (const [k, n, f] of self.rows) console.log(`  ${k.padEnd(34)} ${String(n).padStart(6)} occurrences  ${f} files`)
  console.log(`\nINSTRUMENT A — grammar inventory`)
  console.log(`  the grammar produced ${nts.size} distinct node types across BOTH populations`)
  console.log(`  of ${WOULD_MEAN_IMPLEMENTS.length} node-type names that would express a conformance relation`)
  console.log(`  distinct from a supertype clause, ${present.length} are present`)
  if (present.length) console.log(`  PRESENT: ${present.join(" ")}`)
  console.log(`  ABSENT:  ${WOULD_MEAN_IMPLEMENTS.filter((n) => !nts.has(n)).join(" ")}`)

  console.log(`\nINSTRUMENT B — parse-tree counts (pinned population)`)
  const baseEntries = COUNTERS.baseEntries.occurrences
  console.log(`  denominators: ${COUNTERS.classDefs.occurrences} class definitions, ${baseEntries} base-list entries\n`)
  const order = [
    "classDefs",
    "baseEntries",
    "classHeaderKeywordArguments",
    "keywordArgumentNodes",
    "metaclassArg",
    "abcBase",
    "abcBaseQualified",
    "abcBaseImported",
    "protocolBase",
    "protocolBaseQualified",
    "protocolBaseImported",
    "abstractmethod",
    "abstractmethodImported",
    "registerCallLoose",
    "virtualRegister",
    "implementerDecorated",
  ]
  for (const k of order) {
    const c = COUNTERS[k]
    const f = COUNTER_FILES.get(k)?.size ?? 0
    const pct = baseEntries ? ((c.occurrences / baseEntries) * 100).toFixed(3) : "-"
    console.log(`  ${k.padEnd(24)} ${String(c.occurrences).padStart(6)} occurrences in ${String(f).padStart(4)} files   ${pct}% of base entries`)
    for (const s of c.samples.slice(0, 2)) console.log(`      e.g. ${s}`)
  }
  console.log(`\n  UNPINNED population, same counters (never merged with the above):`)
  for (const k of order) {
    const c = unpinnedReport[k]
    if (!c) continue
    console.log(`    ${k.padEnd(24)} ${String(c.occurrences).padStart(6)} occurrences in ${String(c.files).padStart(4)} files`)
  }
  console.log(`\n  Every base-list entry is ALREADY published as an extends edge by the analyzer.`)
  console.log(`  The question this probe answers is whether any of them means something else.`)
}

if (!self.ok && !SELFTEST_ONLY) {
  console.error(`\nimplements-probe: SELF TEST FAILED. Corpus numbers below are not trustworthy.`)
  process.exit(1)
}