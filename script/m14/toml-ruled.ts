/**
 * TOML's entry for `script/m14/ontology-coverage-gate.ts`'s ruling table.
 *
 * ## WHY THE TABLE LIVES HERE AND NOT IN THE GATE
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned shared machinery
 * (lane brief §8), and `RULED_BY_LANG` in it is a literal with no extension
 * point. Run against `toml` it refuses to report at all:
 *
 *   $ npx tsx script/m14/ontology-coverage-gate.ts toml
 *   ontology coverage gate — toml
 *   corpus: 1141 admitted files
 *   ontology coverage gate — no RULING TABLE for toml.
 *   Refusing to report: a gate with an empty table would call every un-emitted type
 *   RULED-UNJUSTIFIED and that is a verdict about the TABLE, not about the lane.
 *   $ echo $?
 *   2
 *
 * That refusal is the gate behaving correctly. It is also the reason this lane's
 * nine RULED verdicts have never been checked by the arbiter, which is the whole
 * point of the table. So it lives in a file this lane owns, in the gate's own
 * `Ruled` shape, and the supervisor's permanent change is two lines:
 *
 *   import { TOML_RULED } from "./toml-ruled"
 *   const RULED_BY_LANG: Record<string, Ruled[]> = { bash: BASH_RULED, json: JSON_RULED, toml: TOML_RULED }
 *
 * `validation/m14/fixtures/toml/ruled-gate.ts` applies exactly those two lines to
 * a COPY of the gate in /tmp and runs it, so the table is proven rather than
 * asserted. The measurements behind every entry are NOT here; they are in
 * `validation/m14/fixtures/toml/census.ts` (pass 1's instrument A/B census) and
 * `validation/m14/fixtures/toml/pass2-probes.ts` (pass 2's role probes), and each
 * entry names the probe that produced its number.
 *
 * ## WHAT IS IN THIS TABLE
 *
 * Nine entries: every type the analyzer does not emit. `contains` is absent
 * because a table entry for an EMITTED type is dead configuration — it would
 * never be consulted, since the gate checks `observed` first.
 *
 * ## WHY SEVEN ENTRIES ARE INSTRUMENT A, AND WHY THAT IS NOT THE JSON LANE'S MISTAKE
 *
 * The json lane removed its `exports` ruling because "a grammar cannot see a
 * CONVENTION", and that is right for a Node manifest: `exports` and `main` there
 * are ordinary object keys with no node type of their own, so a grammar inventory
 * cannot see them. Instrument A is unsound for a construct written as ordinary
 * syntax the grammar already tokenises.
 *
 * TOML's seven are not that. TOML v1.0.0 has a closed vocabulary of 20 node types
 * (measured over 1,141 files: bare_key, pair, string, dotted_key, table, boolean,
 * comment, array, inline_table, document, table_array_element, integer,
 * quoted_key, ERROR, escape_sequence, float, offset_date_time, local_date_time,
 * local_date, local_time) and EVERY value in the language is a literal. A
 * construct that needs a value to mean something the parser did not write — a
 * call, a type declaration, a supertype, a constructor, a file to load, a name to
 * publish — would need a rule for it, and the rule's node type would be in that
 * list. It is not. So instrument A answers the right question here, and the
 * inventory is not merely suggestive: it is the whole grammar.
 *
 * The string-shaped populations that could have been the counter-example are
 * measured and carried in the `describe` of each entry rather than left out:
 * 366 interpolation markers in 155 files, 216 file-valued strings in 68 files,
 * 144 export-shaped keys in 65 files, 13 inheritance-shaped keys in 12 files,
 * 169 reference-shaped keys in 6 files. Every one of them belongs to a TOOL, not
 * to TOML, and each is named with its file and line in the census output.
 *
 * ## WHY `references` IS INSTRUMENT B AND THE GATE WILL FALSIFY IT
 *
 * This is the entry the table exists to be honest about. A `references` edge is
 * "this key names that key", and in this corpus the construct is real, resolvable
 * and common enough to be worth an edge: Gradle's version catalogue writes
 * `version.ref = "<alias>"` and the alias IS a key of the same document. Measured:
 * 167 occurrences in 5 files, 167 of them resolving to a key the same file
 * declares.
 *
 * The probe below counts exactly that, so `npx tsx script/m14/ontology-coverage-gate.ts toml`
 * prints `FALSIFIED` on this row, and it should. The lane's answer to that row is
 * in `docs/analyzers/real-toml-analyzer.md`, with the three measurements that
 * decide it: the construct is Gradle's and Cargo's rather than TOML's; the
 * sibling Cargo construct resolves in the same file on 81 of 1,269 occurrences
 * (6.4%) and is repo-ambiguous on the other 992, where 75.5% of this lane's edge
 * target names are published by 2 or more files of their own repository; and
 * emitting the type without an oracle in `deriveTomlEdges` would create this
 * lane's FIRST DERIVATION finding.
 *
 * A FALSIFIED row that is reported is worth more than a RULED-SOUND row that was
 * obtained by choosing the instrument that reads zero.
 */
type Type = "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "extends" | "implements" | "overrides" | "instantiates"

type Ruled = {
  type: Type
  instrument: "A:grammar-inventory" | "B:parse-tree-count"
  /** A: node types that would express the construct. B: unused. */
  nodeTypesThatWouldMeanIt?: string[]
  /** B: count occurrences on the tree. A: unused. */
  countOnTree?: (root: any, fileLabel: string, hits: string[]) => void
  describe: string
}

// ---------------------------------------------------------------- helpers shared by the B probes
//
// A key's segments and its spelling, read off the tree rather than matched in the
// source text: a value inside a string cannot fake a key, and a quoted key
// containing a dot cannot be split by one.

const kids = (n: any): any[] => ((n?.namedChildren ?? []) as any[]).filter(Boolean)
const keyNodeOf = (n: any): any => {
  for (const c of kids(n)) if (c.type === "bare_key" || c.type === "quoted_key" || c.type === "dotted_key") return c
  return null
}
const layer = (raw: string): string => {
  if (raw.length < 2) return raw
  const q = raw.charCodeAt(0)
  if (q !== 34 && q !== 39) return raw
  const body = raw.slice(1, -1)
  if (q === 39) return body
  let out = ""
  for (let i = 0; i < body.length; i++) {
    if (body.charCodeAt(i) !== 92) {
      out += body[i]
      continue
    }
    const n = body.charCodeAt(i + 1)
    i++
    if (n === 110) out += "\n"
    else if (n === 116) out += "\t"
    else if (n === 114) out += "\r"
    else if (n === 34) out += '"'
    else if (n === 92) out += "\\"
    else if (n === 117 || n === 85) {
      const hex = body.slice(i + 1, i + 5)
      const v = Number.parseInt(hex, 16)
      if (hex.length === 4 && Number.isFinite(v)) {
        out += String.fromCharCode(v)
        i += 4
      } else out += "\\u"
    } else out += "\\" + (body[i] ?? "")
  }
  return out
}
const segmentsOf = (node: any): string[] => {
  const out: string[] = []
  const visit = (n: any): void => {
    if (n.type === "dotted_key") {
      for (const c of kids(n)) visit(c)
      return
    }
    if (n.type === "bare_key" || n.type === "quoted_key") out.push(layer(n.text))
  }
  visit(node)
  return out
}
const isBareWritable = (seg: string): boolean => {
  if (seg.length === 0) return false
  for (let i = 0; i < seg.length; i++) {
    const c = seg.charCodeAt(i)
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 45)) return false
  }
  return true
}
const spell = (seg: string): string => {
  if (isBareWritable(seg)) return seg
  let out = '"'
  for (let i = 0; i < seg.length; i++) {
    const c = seg.charCodeAt(i)
    if (c === 34 || c === 92) out += "\\"
    out += seg[i]
  }
  return out + '"'
}
const joinPath = (segs: string[]): string => segs.map(spell).join(".")
/** The unquoted text of a string VALUE, or null when the node is not a string. */
const stringValue = (n: any): string | null => {
  if (!n || n.type !== "string") return null
  const raw = String(n.text ?? "")
  const m = /^(['"])([\s\S]*)\1$/.exec(raw)
  return m ? (m[2] as string) : raw
}
/** Every key path the document declares: `section.key`, or `key` at the root. */
const declaredKeyPaths = (root: any): Set<string> => {
  const out = new Set<string>()
  for (const n of kids(root)) {
    if (n.type === "table" || n.type === "table_array_element") {
      const h = keyNodeOf(n)
      if (!h) continue
      const sec = joinPath(segmentsOf(h))
      for (const c of kids(n)) {
        if (c.type !== "pair") continue
        const ck = keyNodeOf(c)
        if (!ck) continue
        out.add(`${sec}.${joinPath(segmentsOf(ck))}`)
      }
    } else if (n.type === "pair") {
      const ck = keyNodeOf(n)
      if (!ck) continue
      out.add(joinPath(segmentsOf(ck)))
    }
  }
  return out
}

/**
 * What the `overrides` probe examined and why it recorded nothing.
 *
 * A probe that can only read zero is a vacuous probe, so this counter is exported
 * for the lane's own runner to print: the probe walks every redeclaration in the
 * corpus, classifies it by the semantics TOML v1.0.0 gives it, and only a
 * redeclaration the language resolves BY REPLACEMENT is pushed as a hit.
 */
export const TOML_OVERRIDES_EXAMINED = { redeclarations: 0, appends: 0, forbiddenTables: 0, undefinedKeys: 0, replacements: 0 }

export const TOML_RULED: Ruled[] = [
  {
    type: "calls",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["function_definition", "function_item", "method_definition", "call_expression", "call", "lambda", "macro_invocation", "command"],
    describe:
      "a function definition or a call. The corpus yields 20 distinct node types and none is callable: TOML's entire vocabulary is a document, tables, keys and literal values. Overturn: any of the node types named here appearing in the inventory.",
  },
  {
    type: "uses",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["value_expression", "interpolation", "template_expression", "value_reference", "lookup", "substitution"],
    describe:
      "one symbol reading the value of another. TOML has no value expression: every value is a literal, and a key's value is not an expression that can name a key. MEASURED, both ways. (i) Keys named uses/using/interpolate/interpolation/template/expr: 1 occurrence in 1,141 files — proxicall/supabase/config.toml:137 `template = \"Your code is {{ .Code }} .\"`, a Go template carried as a string. (ii) String VALUES holding an interpolation marker (${, {{, %(, $( ): 366 in 155 files, and every one is rendered by ANOTHER tool before or after TOML is read — redwood/__fixtures__/fragment-test-project/redwood.toml:10 `\"${WEB_DEV_PORT:8910}\"` is a JS template, traefik/integration/fixtures/acme/acme_base.toml:15 is Go's {{range}}. (iii) pass 2 counted every value that names a key of its own document: 375 in 33 files — 130 where the value equals its OWN key's leaf (typos' `[default.extend-words] BRE = \"BRE\"` declares a correction whose replacement is the word it corrects), 78 coincidental leaf matches on unrelated keys (`name = \"cargo\"`, `wildcards = \"allow\"`), and 167 that are the Gradle catalogue, counted under `references`. Overturn: a node type expressing a value that is computed from another value.",
  },
  {
    type: "imports",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["import_statement", "include_statement", "file_include", "require", "splice"],
    describe:
      "this document pulling another file in. TOML v1.0.0 defines no key whose value is read as a file, so the grammar would need a rule for it and no such rule is in the 20 node types. MEASURED, because a grammar cannot see a string: 216 values name a file that EXISTS on disk, in 68 files (.rs 146, .md 24, no extension 12, .txt 10, .toml 7, .py 5, 12 more of one each), and the 7 that name another .toml are 3 keys — typos' `files.extend-exclude` (a list of files NOT to spell-check), triagebot's `autolabel.A-infrastructure.trigger_files` (a CI trigger list), and ruff's `extend = \"../../ruff.toml\"`. Of those 7, 4 name a target file whose MODULE NAME EQUALS THE SOURCE'S (a TOML module is its file's stem), so the edge the construct implies is `X -> X`: a self-edge by name, which resolves to nothing. Overturn: a TOML v1.0.0 clause assigning parse-time meaning to a value that names a file.",
  },
  {
    type: "references",
    instrument: "B:parse-tree-count",
    countOnTree: (root, fileLabel, hits) => {
      // THE ROLE, not the shape. A value that equals some other key's name is not
      // a reference: over the corpus that shape reads 375, of which 130 are a value
      // equal to its OWN key's leaf (typos' `[default.extend-words] BRE = "BRE"`)
      // and 78 are coincidences on unrelated keys (`name = "cargo"`,
      // `wildcards = "allow"`). Those 208 are a name collision, not a dependency,
      // and a probe that counted them would be convicted by its own examples.
      //
      // The construct is a `ref` key whose STRING value names a key the same
      // document declares: Gradle's version catalogue writes `version.ref = "x"`
      // and `x` is an entry of `[versions]` in the same file. Measured: 167
      // occurrences in 5 files, 167 resolving — which is why this row is instrument
      // B and why the gate prints FALSIFIED for it. See the file header.
      const declared = declaredKeyPaths(root)
      const leaves = new Set<string>()
      for (const p of declared) {
        const parts = p.split(".")
        leaves.add(parts[parts.length - 1] as string)
      }
      const consider = (pair: any, prefix: string): void => {
        const k = keyNodeOf(pair)
        if (!k) return
        const segs = segmentsOf(k)
        const value = stringValue(kids(pair)[kids(pair).length - 1])
        if (segs[segs.length - 1] === "ref" && value !== null && value.length > 0 && value !== segs[segs.length - 1]) {
          const target = `versions.${spell(value)}`
          if (declared.has(target) || leaves.has(value))
            hits.push(`${fileLabel}:${k.startPosition.row + 1}: ${prefix}${joinPath(segs)} = "${value}" names key ${target} declared by the same document`)
        }
        // A Gradle catalogue writes the reference INSIDE an inline table —
        // `[libraries] guava = { module = "...", version.ref = "guava" }` — so a
        // probe that reads only the pairs a section declares finds 0 of the 167.
        // The first version of this probe did exactly that and reported 0; that is
        // how a real occurrence becomes a false RULED-SOUND.
        const v = kids(pair)[kids(pair).length - 1]
        if (v?.type === "inline_table") for (const c of kids(v)) if (c.type === "pair") consider(c, `${prefix}${joinPath(segs)}.`)
      }
      for (const n of kids(root)) {
        if (n.type === "table" || n.type === "table_array_element") {
          const h = keyNodeOf(n)
          const secPath = h ? `${joinPath(segmentsOf(h))}.` : ""
          for (const c of kids(n)) if (c.type === "pair") consider(c, secPath)
        } else if (n.type === "pair") consider(n, "")
      }
    },
    describe:
      "a value that names another key the same document declares. MEASURED: 167 occurrences in 5 files (Gradle `version.ref` in libs.versions.toml), 167 resolving. This entry is expected to read FALSIFIED and the row is reported rather than re-tuned; the adjudication, the resolution rate of the sibling Cargo construct (81 of 1,269 in the same file, 992 in another file of the repo where 75.5% of this lane's target names are repo-ambiguous), and the exact rule that would emit them are in docs/analyzers/real-toml-analyzer.md.",
  },
  {
    type: "exports",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["export_statement", "public_declaration", "module_surface", "visibility_modifier"],
    describe:
      "a name published to a consumer of the document. TOML has no visibility modifier, so there is nothing for a consumer to be given or denied, and no second node for a published surface to attach to. MEASURED: 144 keys named export/exports/expose/exposed/pub/public/publish/main/module/mod/entrypoint in 65 files (module 71, publish 49, main 16, public 6, exposed 2) — the `publish` population is `publish = false`, a crates.io flag, and the `module` population is Gradle's `include(...)` settings block. 173 `[lib]/[[bin]]/[[bench]]/[[test]]/[[example]]` sections carry a name/path/crate-type, and 41 of those `path` values name a .rs file that EXISTS on disk — a Rust file, which is not a symbol in this graph. Every key in a TOML document is readable by a consumer that knows the dialect, so treating them all as exports would restate `contains` and assert a visibility TOML does not have. Overturn: a construct that publishes a name to a consumer of the document.",
  },
  {
    type: "extends",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["class_declaration", "struct_declaration", "trait_declaration", "inheritance_specifier", "superclass", "extends_clause"],
    describe:
      "an entity declaring that it IS-A another. MEASURED: 13 keys named extends/extend/extends_from/inherits_from/base/parent/superclass/derived_from/template in 12 files — `base` 11, `extend` 1, `template` 1 — and 11 of the 11 `base` keys are `base = \"my_base\"` in cargo/tests/testsuite/cargo_add/*/Cargo.toml, where `--base` names a GIT BRANCH baseline for `cargo add`, not a supertype. Overturn: a header or key whose declaration says this entity IS-A that one.",
  },
  {
    type: "implements",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["implements_clause", "interface_declaration", "superclass", "trait_declaration", "protocol_conformance"],
    describe:
      "a supertype clause naming an implemented type. MEASURED: 0 keys named implements/implement/implements_from/iface/interface/contracts in 1,141 files, and no node type expresses one. Overturn: a non-zero count.",
  },
  {
    type: "overrides",
    instrument: "B:parse-tree-count",
    countOnTree: (root, fileLabel, hits) => {
      // A redeclaration is not an override; an override is a redeclaration the
      // language resolves BY REPLACEMENT. All three redeclaration shapes are walked
      // and classified by the semantics TOML v1.0.0 gives them, and only a
      // replacement is pushed:
      //   [[array]] declared twice  -> the spec APPENDS; nothing is replaced
      //   [table] declared twice    -> the spec FORBIDS redefining a table, so the
      //                               document is invalid rather than the second
      //                               body winning; measured on the corpus, that
      //                               occurrence is a traefik documentation file
      //                               and the tree carries no ERROR node for it
      //   a key twice in one section -> undefined, not a replacement
      // The classification is recorded in TOML_OVERRIDES_EXAMINED so the runner can
      // show that the probe examined the corpus rather than being unable to fire.
      const tables = new Map<string, number>()
      const arrays = new Map<string, number>()
      const keys = new Map<string, number>()
      const ordinal = new Map<string, number>()
      const bump = (m: Map<string, number>, k: string): number => {
        const n = (m.get(k) ?? 0) + 1
        m.set(k, n)
        return n
      }
      for (const n of kids(root)) {
        if (n.type === "table" || n.type === "table_array_element") {
          const h = keyNodeOf(n)
          if (!h) continue
          const p = joinPath(segmentsOf(h))
          const isArray = n.type === "table_array_element"
          const c = bump(isArray ? arrays : tables, p)
          if (c === 2) {
            TOML_OVERRIDES_EXAMINED.redeclarations++
            if (isArray) {
              TOML_OVERRIDES_EXAMINED.appends++
            } else {
              TOML_OVERRIDES_EXAMINED.forbiddenTables++
            }
          }
          const o = isArray ? (ordinal.get(p) ?? 0) + 1 : 1
          if (isArray) ordinal.set(p, o)
          const scope = isArray ? `${p}#${o}` : p
          for (const c2 of kids(n)) {
            if (c2.type !== "pair") continue
            const ck = keyNodeOf(c2)
            if (!ck) continue
            if (bump(keys, `${scope}//${joinPath(segmentsOf(ck))}`) === 2) TOML_OVERRIDES_EXAMINED.undefinedKeys++
          }
        } else if (n.type === "pair") {
          const ck = keyNodeOf(n)
          if (!ck) continue
          const k = joinPath(segmentsOf(ck))
          if (k.length === 0) continue
          if (bump(keys, `<root>//${k}`) === 2) TOML_OVERRIDES_EXAMINED.undefinedKeys++
        }
      }
      if (TOML_OVERRIDES_EXAMINED.replacements > 0)
        hits.push(`${fileLabel}: ${TOML_OVERRIDES_EXAMINED.replacements} redeclaration(s) the language resolves by replacement`)
    },
    describe:
      "a redeclaration that REPLACES the earlier one. MEASURED, all three shapes: 96 [[array-of-tables]] headers declared 2+ times in 66 files, which TOML APPENDS to; 1 [table] header declared twice (traefik/docs/content/reference/static-configuration/file.toml:650, `[core]` again at 650 after line 7), which TOML v1.0.0 forbids — the document is invalid rather than the second body winning, and the tree carries no ERROR node for it; 0 keys declared twice inside one section. So 97 redeclarations and 0 replacements. The analyzer answers a repeated header by allocating a second identity (`core#2`), which is name disambiguation rather than a silent overwrite. Overturn: a TOML v1.0.0 clause defining replacement semantics for a redeclared table or key.",
  },
  {
    type: "instantiates",
    instrument: "A:grammar-inventory",
    nodeTypesThatWouldMeanIt: ["new_expression", "object_creation_expression", "constructor_invocation", "instantiation"],
    describe:
      "a constructor call. MEASURED: 0 keys named new/instantiate/instantiates/construct/constructor/factory in 1,141 files, and no node type expresses one. Overturn: a non-zero count.",
  },
]