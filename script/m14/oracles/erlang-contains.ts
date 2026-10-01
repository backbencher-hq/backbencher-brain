/**
 * The Erlang `contains` oracle — LANE-OWNED.
 *
 * It lives here rather than in `differential.ts` for the reason the JSON oracle's
 * header records: that shared file is edited by several lanes at once, and every
 * line a lane keeps out of a shared file is a line that cannot conflict.
 *
 * The oracle is written from Erlang's own module structure and shares no rule
 * table, key set, member list or resolver with `RealErlangAnalyzer`. That is the
 * only property that makes a MATCH mean something: an oracle derived from the
 * analyzer cannot disagree with it.
 *
 * ## Why this oracle exists
 *
 * `contains` had truth for five languages — java, kotlin, scala, csharp,
 * typescript, and since the M60 round also dart — while erlang published `contains`
 * that the differential's allowlist dropped, so none of it was compared and the
 * lane's percentage did not know. The committed lane evidence was
 * `truthSource: manual_audit` over hand-written fixtures, which is a regression
 * test, not a measurement.
 *
 * ## The rule
 *
 * Erlang has no classes. The container of every module-scope declaration is the
 * MODULE, so `contains` is: the module contains the names the file declares at
 * module scope. Both ends are names written in the file, so no resolution is
 * needed.
 *
 * From tree-sitter-erlang's own node types (enumerated from the grammar, not read
 * out of the analyzer):
 *
 *   fun_decl -> function_clause -> atom        a FUNCTION (one per clause; the
 *                                             clauses of one function are one name)
 *   record_decl -> atom                       the RECORD
 *   record_decl -> record_field -> atom       each FIELD of the record
 *   type_alias -> type_name -> atom           a TYPE alias
 *   pp_define -> macro_lhs -> <leading ident> a MACRO; macro_lhs carries the parameter
                                             list too, so `dbg(Fmt, Args)` names `dbg`
 *
 * `spec` is deliberately NOT a member: a `-spec` restates a function's type and is
 * not a separate declaration, so including it would manufacture a row. `module_attribute`
 * and `export_attribute` are likewise not members — the module is the CONTAINER, not
 * something it contains.
 *
 * ## On the owner, and why this oracle does not need it
 *
 * The analyzer's owner is the `-module(...)` name, falling back to the FILE PATH
 * when a file declares no module at all (a real case: OTP's merl/basic_test.erl has
 * its `-module` line commented out because it is textually included elsewhere).
 * That fallback is an analyzer decision this oracle does not mirror, and does not
 * need to: the harness matches a relationship on `(label, target)` only, so the
 * source end is not part of the match. What has to be right is the SET of member
 * names, which is what this derives.
 *
 * The one convention mirrored is the analyzer's collapsing of a function's several
 * clauses into ONE name. `(A, B) when A > B -> ...; (A, B) -> ...` is one function
 * `g/2`, not two, and the analyzer publishes one `g`.
 */

export type ErlangContainsEdge = { label: "contains"; from: string; target: string }

/**
 * The owner used for a file that declares no `-module(...)`. A declared placeholder,
 * not a fabricated module name: an `.hrl` header is not a module, and inventing one
 * from the filename would assert something the file does not say. Matching is on
 * `(label, target)`, so this string never affects whether a row is compared.
 */
export const NO_MODULE = "<no-module>"

export function deriveErlangContainsTruth(root: any): ErlangContainsEdge[] {
  const out: ErlangContainsEdge[] = []
  const seen = new Set<string>()
  const named = (n: any): any[] => (n?.namedChildren ?? [])
  const add = (from: string, target: string): void => {
    const o = String(from ?? "").trim()
    const t = String(target ?? "").trim()
    if (!o || !t) return
    const k = `${o}|${t}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ label: "contains", from: o, target: t })
  }

  // The module name, from `-module(m).` at the top level. Used only so the edge has
  // a source; matching ignores it, but a nameless edge would be a lie in a truth set.
  let moduleName = ""
  for (const c of named(root)) {
    if (c.type !== "module_attribute") continue
    const atom = named(c).find((x: any) => x.type === "atom")
    if (atom?.text) { moduleName = atom.text; break }
  }
  if (!moduleName) {
    // A file with no `-module` still declares things — an `.hrl` header full of
    // macros is the normal case. Rather than invent a module name, the container is
    // a declared placeholder, because the SET of member names is what the comparison
    // uses and the source end is not part of the match. This is not cosmetic: with an
    // empty owner the row was DROPPED rather than emitted unmatched, so
    // `xmerl_internal.hrl` derived zero rows and 108 analyzer rows on a 50-file otp
    // draw had no truth at all.
    moduleName = NO_MODULE
  }

  // Declarations are not all at the top level. Erlang's preprocessor conditionals
  // (`-ifdef`, `-if`, `-else`, `-endif`) wrap real declarations, and OTP headers lean
  // on them heavily: `xmerl_internal.hrl` declares every one of its macros inside a
  // `pp_ifdef`/`pp_else` pair, so a top-level-only walk derived ZERO rows for it and
  // 108 analyzer rows on a 50-file otp draw had no truth. These are compilation
  // conditionals, not new scopes — the declaration still belongs to the module — so
  // they are flattened, not descended-and-scoped.
  const PREPROC = new Set(["pp_ifdef", "pp_if", "pp_else", "pp_elseif", "pp_endif"])
  const flatten = (n: any): any[] => {
    const out: any[] = []
    for (const c of named(n)) {
      if (PREPROC.has(c.type)) out.push(...flatten(c))
      else out.push(c)
    }
    return out
  }

  for (const c of flatten(root)) {
    switch (c.type) {
      case "fun_decl": {
        // every clause of one function is ONE name
        for (const clause of named(c).filter((x: any) => x.type === "function_clause")) {
          const atom = named(clause).find((x: any) => x.type === "atom")
          if (atom?.text) add(moduleName, atom.text)
        }
        break
      }
      case "record_decl": {
        // the record itself, then each of its fields
        for (const atom of named(c).filter((x: any) => x.type === "atom")) {
          if (atom.text) add(moduleName, atom.text)
        }
        for (const f of named(c).filter((x: any) => x.type === "record_field")) {
          const atom = named(f).find((x: any) => x.type === "atom")
          if (atom?.text) add(moduleName, atom.text)
        }
        break
      }
      case "type_alias": {
        const tn = named(c).find((x: any) => x.type === "type_name")
        const atom = tn ? named(tn).find((x: any) => x.type === "atom") : null
        if (atom?.text) add(moduleName, atom.text)
        break
      }
      case "pp_define": {
        // A macro's name lives in `macro_lhs`, NOT in a direct `atom` child — and
        // `macro_lhs` carries the parameter list too: `dbg(Fmt, Args)`. The first
        // version looked for an `atom` child, found none, and so derived no macro at
        // all: 138 analyzer rows on a 50-file otp draw (`dbg`, `DBG`, `SMALL`, `L`)
        // had no truth, and the corpus — not the grammar — is what showed it.
        const lhs = named(c).find((x: any) => x.type === "macro_lhs")
        if (lhs?.text) {
          const m = String(lhs.text).match(/^([A-Za-z_][A-Za-z0-9_@]*)/)
          if (m) add(moduleName, m[1])
        }
        break
      }
      default:
        break
    }
  }
  return out
}