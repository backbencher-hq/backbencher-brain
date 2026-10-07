/**
 * PYTHON CONSTRUCT CENSUS — does the LANGUAGE have an `implements` edge?
 *
 * JOB 2 of the ontology workstream: a missing type is a fact about the FORMAT. Three
 * verdicts are allowed and two of them require a measurement, not an argument:
 *
 *   - the construct occurs in the corpus  -> GAP, implement it
 *   - the construct does not occur        -> RULED, with this file as the measurement
 *   - the language has no such construct  -> RULED on the grammar's own node inventory
 *
 * The workstream names two instruments and both are here:
 *   A. grammar-inventory   — every node TYPE the grammar actually produces across the
 *                            corpus. A language with no declaration node cannot express
 *                            the relationship. Printed as `NODE INVENTORY`.
 *   B. parse-tree semantic count — for a construct Python CAN express, a count on the
 *                            tree, where a string literal or a comment cannot fake it.
 *                            This is what `does implements exist` turns on.
 *
 * WHY NOT A REGEX. The workstream records two false positives produced by text probes:
 * a bash probe for `extends` matched the words `class voice` inside a telnet IAC word
 * list in a string literal; a probe for `instantiates` matched `new Map(` in embedded
 * JavaScript inside a heredoc. Every count below is taken from a tree-sitter node, by
 * node.type and named children. Nothing here reads source text. (programme rule 1)
 *
 * THE POPULATION IS DERIVED, never hand-written, and it is printed next to every count
 * (docs/M14-HONESTY-CONTRACT.md §"an instrument must declare the population it covered":
 * a count of zero is a claim that needs its population attached).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

interface CorpusFile { repo: string; rel: string; abs: string }

const REPO = process.env.BB_REPO ?? "$HOME/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS ?? "$HOME/fixtures/repositories"
const PY_CORPUS = process.env.BB_PY_CORPUS ?? join(CORPUS_ROOT, "python-corpus")
const LIMIT = Number(process.env.LIMIT ?? 0) // 0 = whole derived population
const EXTS = [".py", ".pyi"]

/**
 * The population, DERIVED, and this is where the second measurement defect of this
 * session was found.
 *
 * CORPUS_PY and CORPUS_PY2 both derived the population with `git ls-files` per repo and
 * both reported 5,364 files. Correct arithmetic, wrong population: `python-corpus/`
 * also holds `cpython-stdlib/`, an unpacked CPython 3.10 `Lib/` copy with no `.git`, and
 * a `git ls-files` derivation silently DROPS a directory that has no repository in it.
 * CPython's stdlib is the single densest source of abstract-base usage in the language —
 * `abc`, `_py_abc`, `numbers`, `inspect`, `importlib/abc`, `typing` all live there, and
 * 135 `@abstractmethod` sites are in that copy alone against 153 in the other five repos
 * combined. Ruling `implements` on a population that excludes the standard library would
 * be the exact failure the workstream was written about.
 *
 * So the population is derived from the FILESYSTEM, and the git-tracked subset is
 * reported next to it rather than standing in for it. A directory with no `.git`
 * contributes its whole tree; a hand-written `FILES = [...]` would rot silently and
 * report `0` with total confidence.
 */
function deriveCorpus(): { files: CorpusFile[]; sources: { name: string; admitted: number; how: string }[] } {
  if (!existsSync(PY_CORPUS)) {
    console.error(`\nCONSTRUCT CENSUS: no python corpus at ${PY_CORPUS}. Refusing to count over an empty population.\n`)
    process.exit(2)
  }
  const files: CorpusFile[] = []
  const sources: { name: string; admitted: number; how: string }[] = []
  // Only caches and VCS metadata are excluded. An earlier draft also skipped
  // test/tests/idlelib/lib2to3, which quietly cut the population from ~5,900 to 2,236
  // and would have thrown away every pydantic/django test that uses @abstractmethod —
  // precisely the construct under investigation. A census population is every file the
  // corpus holds; the corpus, not the instrument, decides what is in scope.
  const SKIP_DIR = new Set([".git", "node_modules", "__pycache__", ".tox", ".mypy_cache"])
  for (const e of readdirSync(PY_CORPUS, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === ".git") continue
    const dir = join(PY_CORPUS, e.name)
    let isGit = false
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }); isGit = true } catch { isGit = false }
    let admitted = 0
    const stack: string[] = [dir]
    while (stack.length) {
      const d = stack.pop()!
      let ents
      try { ents = readdirSync(d, { withFileTypes: true }) } catch { continue }
      for (const x of ents) {
        if (x.isDirectory()) {
          if (SKIP_DIR.has(x.name)) continue
          stack.push(join(d, x.name))
        } else if (EXTS.some((t) => x.name.endsWith(t))) {
          const abs = join(d, x.name)
          let size = 0
          try { size = statSync(abs).size } catch { continue }
          if (size > 400_000) continue
          const rel = abs.slice(dir.length + 1)
          if (isGit) {
            // keep the derived population honest: only files the repo TRACKS
            tracked.add(`${e.name}\0${rel}`)
          }
          files.push({ repo: e.name, rel, abs })
          admitted++
        }
      }
    }
    sources.push({ name: e.name, admitted, how: isGit ? "filesystem walk of a git repo" : "filesystem walk (no .git — NOT in git ls-files)" })
  }
  if (!files.length) {
    console.error(`\nCONSTRUCT CENSUS: derived population is EMPTY over ${PY_CORPUS}. Refusing to print a count about nothing.\n`)
    process.exit(2)
  }
  return { files, sources }
}

const tracked = new Set<string>()

/* ------------------------------------------------------------------ *
 * Tree helpers. Cursor walk only — node.type and named children.
 * ------------------------------------------------------------------ */
type N = any

/** Walk every node under `root`, visiting parents before children. */
function walk(root: N, visit: (n: N) => void): void {
  const stack: N[] = [root]
  while (stack.length) {
    const n = stack.pop()
    visit(n)
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

/**
 * The HEAD of a name expression, defined the way the analyzer's `extends` rule defines
 * it: `a.b.C` -> `C`, `Repository[User]` -> `Repository`, `abc.ABC` -> `ABC`.
 *
 * DEFECT FOUND IN THIS FILE'S FIRST DRAFT, recorded because it is exactly the class of
 * error this instrument exists to catch. The first version returned
 * `leafName(attribute) = leafName(object)`, i.e. the RECEIVER: `abc.abstractmethod`
 * read as `abc`. That silently produced "0 @abstractmethod in 5,364 files" while the
 * same run's own import census (B8) found `abstractmethod` imported from `abc` in 16
 * files. One method walking an attribute the wrong way turned a real construct into a
 * measured zero, and a measured zero is a RULING. Two internally inconsistent numbers
 * in the same table is what caught it.
 */
function leafName(n: N): string | null {
  if (!n) return null
  if (n.type === "identifier") return n.text
  if (n.type === "subscript") {
    const v = n.childForFieldName?.("value")
    return v ? leafName(v) : null
  }
  if (n.type === "attribute") {
    const a = n.childForFieldName?.("attribute")
    return a ? a.text : null
  }
  // `decorator` wraps the decorated expression: `@abstractmethod` -> decorator >
  // identifier, `@abc.abstractmethod` -> decorator > attribute.
  // DEFECT 2 IN THIS FILE, same class as the first: without this, every
  // `@abstractmethod` measured 0 while the same run counted the import in 16 files.
  if (n.type === "decorator") return n.namedChild(0) ? leafName(n.namedChild(0)) : null
  return null
}

/** Dotted-name text of a name expression, `abc.ABC` -> "abc.ABC". */
function dottedText(n: N): string | null {
  if (!n) return null
  if (n.type === "identifier") return n.text
  if (n.type === "attribute") {
    const o = n.childForFieldName?.("object")
    const a = n.childForFieldName?.("attribute")
    if (!o || !a) return null
    const ot = dottedText(o)
    return ot ? `${ot}.${a.text}` : a.text
  }
  if (n.type === "decorator") return n.namedChild(0) ? dottedText(n.namedChild(0)) : null
  return null
}

/** The dotted head of an attribute chain, e.g. `abc.ABC` -> "abc". */
function attrRoot(n: N): string | null {
  if (!n) return null
  if (n.type === "identifier") return n.text
  if (n.type === "attribute") {
    const o = n.childForFieldName?.("object")
    return o ? attrRoot(o) : null
  }
  return null
}

const { getParser } = await import(`${REPO}/src/ast/engine.ts`)
const { files: ALL, sources } = deriveCorpus()
const FILES = LIMIT > 0 ? ALL.slice(0, LIMIT) : ALL

console.log(`python construct census   repo=${REPO}`)
console.log(`corpus root: ${PY_CORPUS}`)
console.log(`population, DERIVED (filesystem walk, ${EXTS.join("/")}, <=400000 bytes, only caches skipped): ${ALL.length} files across ${sources.length} source(s)`)
for (const r of sources) console.log(`  ${r.name.padEnd(14)} admitted ${String(r.admitted).padStart(5)}   ${r.how}`)
if (FILES.length !== ALL.length) console.log(`MEASURED OVER: first ${FILES.length} of ${ALL.length} by derived order (LIMIT=${LIMIT}) — this is a SAMPLE, not the population`)

/* ------------------------------------------------------------------ *
 * Instrument A — grammar inventory: every node type the grammar produces.
 * ------------------------------------------------------------------ */
const nodeTypes = new Map<string, number>()

/* ------------------------------------------------------------------ *
 * Instrument B — the constructs that could carry an `implements` edge.
 * ------------------------------------------------------------------ */
interface Finding { file: string; line: number; text: string; detail: string }

const add = (list: Finding[], f: Finding) => { if (list.length < 400) list.push(f) }

const baseLeaves = new Map<string, { n: number; files: Set<string> }>()
const classes = { total: 0, withBases: 0, keywordArgs: 0, files: new Set<string>() }
const metaclassArg = { count: 0, leaves: new Map<string, number>(), ex: [] as Finding[] }
/** A base leaf named by a `from abc import X` / `from typing import X` IN THIS FILE. */
const markerImports = new Map<string, { n: number; from: Set<string> }>()
/** class bases this file PROVES are an interface/abstract declaration (abc.ABC,
 *  abc.ABCMeta, typing.Protocol, anything from collections.abc). */
const implementsByMarkerBase = { count: 0, files: new Set<string>(), ex: [] as Finding[], byLeaf: new Map<string, number>() }
const implementsByMetaclass = { count: 0, files: new Set<string>(), ex: [] as Finding[] }
/** defs decorated @abstractmethod/@abstractproperty/... inside a class body. */
const abstractDecoratedMethods = { count: 0, files: new Set<string>(), ex: [] as Finding[], byLeaf: new Map<string, number>() }
/** classes that DECLARE at least one abstract method — an interface declaration itself. */
const classesDeclaringAbstract = { count: 0, files: new Set<string>(), ex: [] as Finding[] }
/** `SomeABC.register(SomeClass)` — Python's virtual-subclass declaration, no inheritance. */
const registerCalls = {
  all: 0, homonym: 0, files: new Set<string>(),
  exAll: [] as Finding[], exHomonym: [] as Finding[],
  recvLeaves: new Map<string, number>(),
}
/** `abc.register(X)` spelled dotted — self-proving, no import needed. */
const registerDotted = { count: 0, ex: [] as Finding[] }
/** typing.Generic in a base list — deliberately EXCLUDED from implements; counted so the
 *  exclusion is measured rather than asserted. */
const genericBases = { count: 0 }
/** A class whose bases include a marker spelled bare but NOT proven in this file. */
const markerBaseUnproven = { count: 0, ex: [] as Finding[], byLeaf: new Map<string, number>() }
/** Any `Protocol` usage at all: base, base-of-protocol, or `isinstance` runtime check. */
const protocolBases = { count: 0, files: new Set<string>(), ex: [] as Finding[] }
const abcNameNodes = { abc: 0, ABCMeta: 0, ABC: 0, Protocol: 0, abstractmethod: 0 }

let parsed = 0
let failed = 0
let errorNodes = 0

/** Names from `abc` that declare an abstract BASE CLASS rather than an interface to satisfy. */
const ABC_NAMES = new Set(["ABC", "ABCMeta"])
/** Names from `typing`. Protocol IS an interface; Generic is NOT — see the Generic note. */
const TYPING_IFACE_NAMES = new Set(["Protocol"])

for (const f of FILES) {
  let content: string
  try { content = readFileSync(f.abs, "utf8") } catch { failed++; continue }
  let pr: N
  try {
    const parser = await getParser("python")
    pr = await parser.parse(content, f.abs)
  } catch { failed++; continue }
  parsed++
  const root: N = pr.rootNode
  const label = `${f.repo}/${f.rel}`

  /** localName -> module it came from, for INTERFACE_MODULES only. */
  const proven = new Map<string, string>()
  /** localName, for the abc DECORATOR names (abstractmethod & friends). */
  const provenAbstractDeco = new Set<string>()
  /** dotted roots proved importable: "abc", "typing", "collections" */
  const provenRoots = new Set<string>()
  /** every stdlib collections.abc name this file imported — every one is an ABC. */
  const collectionsAbcNames = new Map<string, number>()
  proven.clear(); provenAbstractDeco.clear(); provenRoots.clear(); collectionsAbcNames.clear()

  // --- pass 1: what this file PROVES about the names it uses ---------------
  walk(root, (n) => {
    if (n.type === "import_statement") {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c?.type !== "dotted_name") continue
        provenRoots.add(c.text.split(".")[0])
      }
      return
    }
    if (n.type !== "import_from_statement") return
    const m = n.childForFieldName?.("module_name")
    const mod = m?.text ?? ""
    // `from collections import abc` binds the NAME `abc`, so `collections.abc.X` is provable
    const isCollectionsAbcAlias = mod === "collections"
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (!c || c === m) continue
      let nmText: string | null = null
      let bound: string | null = null
      if (c.type === "identifier") { nmText = c.text; bound = c.text }
      else if (c.type === "dotted_name") {
        nmText = c.text
        const dot = c.text.lastIndexOf(".")
        bound = dot >= 0 ? c.text.slice(dot + 1) : c.text
      } else if (c.type === "aliased_import") {
        const nm = c.childForFieldName?.("name")
        const al = c.childForFieldName?.("alias")
        nmText = nm?.text ?? null
        bound = al?.text ?? (nmText ? nmText.split(".").pop()! : null)
      }
      if (!nmText || !bound) continue
      if (isCollectionsAbcAlias && nmText === "abc") { provenRoots.add("collections"); proven.set("abc", "collections.abc"); continue }
      if (mod === "abc") {
        if (ABC_NAMES.has(bound)) proven.set(bound, mod)
        if (bound === "abstractmethod" || bound === "abstractproperty" || bound === "abstractclassmethod" || bound === "abstractstaticmethod") {
          provenAbstractDeco.add(bound)
        }
        proven.set(bound, mod)
      } else if (mod === "typing" || mod === "typing_extensions") {
        // `typing_extensions` is the backport and is what a library that still supports
        // 3.7 imports. Measured on this corpus: `_decorators_v1.py` and 5 other pydantic
        // files write `from typing_extensions import Protocol`, and the first version of
        // this census scored those 36 `Protocol` bases as UNPROVEN — a correct number
        // about a population that had silently narrowed itself to `typing`. The same
        // defect the honesty contract records for the dart census (43,042 claimed over
        // 1,250 of 2,735 files). Proof has to cover what the corpus actually writes.
        if (TYPING_IFACE_NAMES.has(bound)) proven.set(bound, mod)
      } else if (mod === "collections.abc") {
        // EVERY name in collections.abc is an abstract base class by the stdlib's own
        // definition — that module exists to be the interface catalogue.
        proven.set(bound, mod)
        collectionsAbcNames.set(bound, (collectionsAbcNames.get(bound) ?? 0) + 1)
      }
    }
  })
  for (const [k, v] of proven) {
    let e = markerImports.get(k)
    if (!e) { e = { n: 0, from: new Set() }; markerImports.set(k, e) }
    e.n++
    e.from.add(v)
  }

  // --- pass 2: constructs ---------------------------------------------------
  walk(root, (n) => {
    const t = n.type
    nodeTypes.set(t, (nodeTypes.get(t) ?? 0) + 1)
    if (t === "ERROR") errorNodes++

    if (t === "class_definition") {
      classes.total++
      classes.files.add(label)
      const al = n.childForFieldName?.("superclasses")
      if (al) {
        classes.withBases++
        for (let i = 0; i < al.namedChildCount; i++) {
          const b = al.namedChild(i)
          if (!b || b.type === "keyword_argument") continue
          const leaf = leafName(b)
          if (!leaf) continue
          let e = baseLeaves.get(leaf)
          if (!e) { e = { n: 0, files: new Set() }; baseLeaves.set(leaf, e) }
          e.n++
          if (e.files.size < 3) e.files.add(label)

          // The dotted spelling `abc.ABC` is self-proving; the bare spelling `ABC`
          // needs this file's own import to prove it, or it is just a class called ABC.
          const dotted = dottedText(b)
          const dottedProvable = dotted !== null && (
            (provenRoots.has(dotted.split(".")[0]) && (dotted === "abc.ABC" || dotted === "abc.ABCMeta" ||
              dotted === "typing.Protocol" || dotted === "abc.Protocol" || dotted === "abc.abstractmethod")) ||
            (provenRoots.has("collections") && dotted.startsWith("collections.abc."))
          )
          const module = proven.get(leaf)
          const bareProvable = module !== undefined &&
            (ABC_NAMES.has(leaf) || TYPING_IFACE_NAMES.has(leaf) || module === "collections.abc")

          if (leaf === "Protocol" && (module === "typing" || dottedProvable)) {
            protocolBases.count++
            protocolBases.files.add(label)
            add(protocolBases.ex, { file: label, line: n.startPosition.row + 1, text: b.text, detail: "Protocol base" })
          }
          if (dottedProvable || bareProvable) {
            implementsByMarkerBase.count++
            implementsByMarkerBase.files.add(label)
            implementsByMarkerBase.byLeaf.set(`${module ?? dotted?.split(".")[0]}::${leaf}`,
              (implementsByMarkerBase.byLeaf.get(`${module ?? dotted?.split(".")[0]}::${leaf}`) ?? 0) + 1)
            add(implementsByMarkerBase.ex, {
              file: label, line: n.startPosition.row + 1, text: b.text,
              detail: `base ${b.text} proven from ${module ?? dotted}`,
            })
          } else if (ABC_NAMES.has(leaf) || TYPING_IFACE_NAMES.has(leaf)) {
            // Same SPELLING, unproven in this file. A user class named ABC is legal
            // Python, so this is the R7-shaped question and it is counted, not merged.
            markerBaseUnproven.count++
            markerBaseUnproven.byLeaf.set(leaf, (markerBaseUnproven.byLeaf.get(leaf) ?? 0) + 1)
            add(markerBaseUnproven.ex, { file: label, line: n.startPosition.row + 1, text: b.text, detail: `base leaf ${leaf}, no ${leaf === "Protocol" ? "typing" : "abc"} import in this file` })
          }
          if (leaf === "Generic") genericBases.count++
        }
      }
      if (al) {
        for (let i = 0; i < al.namedChildCount; i++) {
          const b = al.namedChild(i)
          if (b?.type !== "keyword_argument") continue
          classes.keywordArgs++
          const nm = b.childForFieldName?.("name")?.text ?? ""
          const val = b.childForFieldName?.("value")
          const vleaf = leafName(val)
          const vdotted = dottedText(val)
          metaclassArg.count++
          if (vleaf) metaclassArg.leaves.set(`${nm}=${vleaf}`, (metaclassArg.leaves.get(`${nm}=${vleaf}`) ?? 0) + 1)
          add(metaclassArg.ex, { file: label, line: n.startPosition.row + 1, text: b.text, detail: `keyword arg ${nm}` })
          if (nm === "metaclass" && (vleaf === "ABCMeta" || vdotted === "abc.ABCMeta")) {
            implementsByMetaclass.count++
            implementsByMetaclass.files.add(label)
            add(implementsByMetaclass.ex, { file: label, line: n.startPosition.row + 1, text: b.text, detail: "metaclass=ABCMeta" })
          }
        }
      }
      // A class that DECLARES abstract methods is an interface declaration in its own
      // right — that is the shape `abc` documents for a hand-written abstract base.
      const body = n.childForFieldName?.("body")
      if (body) {
        let declaredAbstract = 0
        walk(body, (m) => {
          if (m.type !== "decorator") return
          const dl = leafName(m)
          const ddotted = dottedText(m)
          const proved = provenAbstractDeco.has(dl ?? "") ||
            (ddotted !== null && provenRoots.has("abc") && ddotted.startsWith("abc."))
          if (!proved) return
          const parent = m.parent
          const isDef = parent?.type === "decorated_definition" &&
            parent.childForFieldName?.("definition")?.type === "function_definition"
          if (!isDef) return
          declaredAbstract++
          abstractDecoratedMethods.count++
          abstractDecoratedMethods.files.add(label)
          abstractDecoratedMethods.byLeaf.set(dl ?? ddotted ?? "?", (abstractDecoratedMethods.byLeaf.get(dl ?? ddotted ?? "?") ?? 0) + 1)
          add(abstractDecoratedMethods.ex, { file: label, line: m.startPosition.row + 1, text: m.text, detail: "on a def in a class body" })
        })
        if (declaredAbstract > 0) {
          classesDeclaringAbstract.count++
          classesDeclaringAbstract.files.add(label)
          add(classesDeclaringAbstract.ex, { file: label, line: n.startPosition.row + 1, text: `${declaredAbstract} abstract method(s)`, detail: "class declares abstract methods" })
        }
      }
    }

    if (t === "decorator" && !n.parent?.parent) { /* top-level decorators counted above */ }

    if (t === "identifier") {
      if (n.text === "ABCMeta") abcNameNodes.ABCMeta++
      else if (n.text === "ABC") abcNameNodes.ABC++
      else if (n.text === "Protocol") abcNameNodes.Protocol++
      else if (n.text === "abstractmethod") abcNameNodes.abstractmethod++
    }
    if (t === "attribute") {
      const r = attrRoot(n)
      if (r === "abc") abcNameNodes.abc++
    }

    // `X.register(Y)` — Python's virtual-subclass declaration. Measured NOT to be one:
    // `.register` is overwhelmingly a homonym (Flask blueprints, dict-like registries),
    // so the count is split by whether the receiver is PROVABLY an abc. The split IS the
    // ruling: if the homonym dominates, `.register` cannot carry an edge without name
    // resolution this analyzer does not have.
    if (t === "call") {
      const fn = n.childForFieldName?.("function")
      if (fn?.type === "attribute") {
        const attr = fn.childForFieldName?.("attribute")
        if (attr?.text === "register") {
          const recv = fn.childForFieldName?.("object")
          const recvLeaf = leafName(recv)
          const recvDotted = dottedText(recv)
          const args = n.childForFieldName?.("arguments")
          const firstArg = args?.namedChild?.(0)
          const argLeaf = leafName(firstArg)
          registerCalls.all++
          registerCalls.files.add(label)
          if (recvLeaf) registerCalls.recvLeaves.set(recvLeaf, (registerCalls.recvLeaves.get(recvLeaf) ?? 0) + 1)
          add(registerCalls.exAll, {
            file: label, line: n.startPosition.row + 1, text: n.text.slice(0, 110).split("\n").join(" "),
            detail: `recv=${recvDotted ?? recvLeaf ?? "?"} arg=${argLeaf ?? "?"}`,
          })
          // Provable iff spelled `abc.register`, or the receiver name is one this file
          // imported FROM abc, or it is a dotted collections.abc name.
          const recvProved = (recvDotted !== null && recvDotted.split(".")[0] === "abc" && provenRoots.has("abc")) ||
            (recvLeaf !== null && proven.get(recvLeaf) === "abc") ||
            (recvDotted !== null && recvDotted.startsWith("collections.abc."))
          if (recvDotted !== null && recvDotted === "abc.register") {
            registerDotted.count++
            add(registerDotted.ex, { file: label, line: n.startPosition.row + 1, text: n.text.slice(0, 110).split("\n").join(" "), detail: "abc.register, self-proving dotted spelling" })
          }
          if (recvProved) {
            registerCalls.proved = (registerCalls.proved ?? 0) + 1
            add(registerCalls.exProved ?? (registerCalls.exProved = [] as Finding[]), {
              file: label, line: n.startPosition.row + 1, text: n.text.slice(0, 110).split("\n").join(" "),
              detail: `receiver PROVEN from abc: ${recvDotted ?? recvLeaf}`,
            })
          } else {
            registerCalls.homonym++
          }
        }
      }
    }
  })
}

/* ------------------------------------------------------------------ *
 * Report.
 * ------------------------------------------------------------------ */
const PCT = (n: number) => `${((n / Math.max(1, parsed)) * 100).toFixed(2)}%`
const show = (label: string, n: number, files: Set<string> | undefined, ex: Finding[], extra = "") => {
  console.log(`\n${label}: ${n}${files ? ` in ${files.size} files` : ""}   (${PCT(n)} of ${parsed} parsed files)${extra}`)
  for (const e of ex.slice(0, 6)) console.log(`    ${e.file}:${e.line}  ${e.text.slice(0, 110).split("\n").join(" ")}   [${e.detail}]`)
}

console.log(`\nparsed ${parsed} files, ${failed} failed, ${errorNodes} ERROR nodes`)
console.log(`classes seen: ${classes.total} in ${classes.files.size} files; ${classes.withBases} carry a base list; ${classes.keywordArgs} carry a keyword_argument in the base list`)

console.log(`\n=== A. GRAMMAR INVENTORY — node types the python grammar actually produced ===`)
const sortedTypes = [...nodeTypes.entries()].sort((a, b) => b[1] - a[1])
console.log(`${sortedTypes.length} distinct node types over ${parsed} files:`)
for (let i = 0; i < sortedTypes.length; i += 8) {
  console.log("  " + sortedTypes.slice(i, i + 8).map(([k, v]) => `${k}:${v}`).join("  "))
}
// The positive-evidence test the workstream asks for: is there ANY node type that
// could express an interface/abstract declaration distinct from a class declaration?
const INTERFACEISH = ["interface_declaration", "protocol_declaration", "abstract_class_declaration", "abstract_class", "implements_clause", "trait_declaration"]
console.log(`\ninterface/abstract-specific node types present: ${INTERFACEISH.filter((x) => nodeTypes.has(x)).join(" ") || "(none)"}`)
console.log(`  class_definition: ${nodeTypes.get("class_definition") ?? 0}`)
console.log(`  -> python has ONE class-declaration node and no interface node, so an`)
console.log(`     implements edge cannot come from a distinct grammar construct. It has to`)
console.log(`     come from something INSIDE the base list / decorators / calls. Measured below.`)

console.log(`\n=== B. CONSTRUCT COUNTS (parse-tree semantic counts) ===`)
console.log(`\n-- B1. base leaves, most frequent 30 of ${baseLeaves.size} distinct --`)
const bs = [...baseLeaves.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 30)
for (const [leaf, e] of bs) console.log(`    ${String(e.n).padStart(6)}  ${leaf.padEnd(28)} in ${e.files.size >= 3 ? "3+ files" : `${e.files.size} file(s)`}`)

show("B2. class bases this file PROVES are an interface/abstract declaration", implementsByMarkerBase.count, implementsByMarkerBase.files, implementsByMarkerBase.ex,
  `  by module::leaf: ${[...implementsByMarkerBase.byLeaf.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
show("B3. class with metaclass=ABCMeta", implementsByMetaclass.count, implementsByMetaclass.files, implementsByMetaclass.ex)
show("B4. defs in a class body decorated with a PROVEN abc abstract decorator", abstractDecoratedMethods.count, abstractDecoratedMethods.files, abstractDecoratedMethods.ex,
  `  by leaf: ${[...abstractDecoratedMethods.byLeaf.entries()].map(([k, v]) => `${k}:${v}`).join(" ")}`)
show("B4b. CLASSES that declare >=1 abstract method (an interface declaration of their own)", classesDeclaringAbstract.count, classesDeclaringAbstract.files, classesDeclaringAbstract.ex)
show("B5. `X.register(Y)` calls — ALL", registerCalls.all, registerCalls.files, registerCalls.exAll)
console.log(`\nB5a. of those, receiver PROVEN to be an abc (could carry a virtual-subclass edge): ${registerCalls.proved ?? 0}`)
for (const e of (registerCalls.exProved ?? []).slice(0, 8)) console.log(`    ${e.file}:${e.line}  ${e.text}   [${e.detail}]`)
console.log(`B5b. of those, receiver is a HOMONYM (flask blueprint .register, dict .register, self.register): ${registerCalls.homonym}`)
console.log(`     top receiver leaves: ${[...registerCalls.recvLeaves.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join("  ")}`)
console.log(`B5c. spelled ` + "`abc.register(X)`" + ` (self-proving dotted form): ${registerDotted.count}`)
for (const e of registerDotted.ex.slice(0, 8)) console.log(`    ${e.file}:${e.line}  ${e.text}   [${e.detail}]`)
show("B6. typing.Protocol in a base list", protocolBases.count, protocolBases.files, protocolBases.ex)
console.log(`\nB7. marker SPELLING in a base list with NO proving import in the file (the R7 shape): ${markerBaseUnproven.count}`)
if (markerBaseUnproven.byLeaf.size) console.log(`    by leaf: ${[...markerBaseUnproven.byLeaf.entries()].map(([k, v]) => `${k}:${v}`).join(" ")}`)
for (const e of markerBaseUnproven.ex.slice(0, 8)) console.log(`    ${e.file}:${e.line}  ${e.text.slice(0, 110).split("\n").join(" ")}   [${e.detail}]`)

console.log(`\nB8. interface-module names imported across the corpus:`)
const provenNames = [...markerImports.entries()].sort((a, b) => b[1].n - a[1].n)
for (const [k, v] of provenNames.slice(0, 25)) console.log(`    ${k.padEnd(18)} ${String(v.n).padStart(5)} files  from ${[...v.from].join(" ")}`)
console.log(`    ...${Math.max(0, provenNames.length - 25)} more distinct names`)

console.log(`\nB9. bare identifier occurrences anywhere in the corpus (UPPER BOUND only — an identifier node is real syntax, but a bare name proves nothing):`)
console.log(`    abc:${abcNameNodes.abc}  ABC:${abcNameNodes.ABC}  ABCMeta:${abcNameNodes.ABCMeta}  Protocol:${abcNameNodes.Protocol}  abstractmethod:${abcNameNodes.abstractmethod}`)
console.log(`B10. typing.Generic in a base list — EXCLUDED from implements on purpose: ${genericBases.count}`)
console.log(`     Generic is a type-parameter marker, not an interface. It is counted here so the`)
console.log(`     exclusion is a measurement rather than an assertion.`)

const anyDecl = implementsByMarkerBase.count + implementsByMetaclass.count + classesDeclaringAbstract.count
console.log(`\n=== C. VERDICT INPUT ===`)
console.log(`classes with a PROVEN interface/abstract base                    : ${implementsByMarkerBase.count} (in ${implementsByMarkerBase.files.size} files)`)
console.log(`classes with metaclass=ABCMeta                                    : ${implementsByMetaclass.count} (in ${implementsByMetaclass.files.size} files)`)
console.log(`classes DECLARING >=1 abstract method                             : ${classesDeclaringAbstract.count} (in ${classesDeclaringAbstract.files.size} files)`)
console.log(`sum of the three (a class may hit more than one shape)             : ${anyDecl}`)
console.log(`classes total in corpus                                           : ${classes.total}`)
console.log(`classes whose base-list interface spelling is UNPROVEN in-file    : ${markerBaseUnproven.count}`)
console.log(`X.register(Y): all ${registerCalls.all} · receiver proven-abc ${registerCalls.proved ?? 0} · homonym ${registerCalls.homonym} · spelled abc.register ${registerDotted.count}`)
console.log(`population this was measured over: ${parsed} parsed files of a derived population of ${ALL.length}`)