// src/lsp/signature.ts — M55.T4 (issue #772 sibling, §14 Truth Rule 4: human
// text is human).
//
// The analyzers store parameters as STRUCTURED data (`parameters` is a JSON
// array — verified across every brain.db on this machine: 148 rows, six key
// shapes, no unparseable value). The hover used to interpolate that string
// straight into the card, so a developer read:
//
//   public method greetAll([{"name":"names","type":"string[]","isOptional":false}]) → string[]
//
// That is serialization, not a signature. This module is the ONE owner of the
// rendered form: hover, the hub rows and the call-hierarchy item detail all
// render through `renderSignature`, and nothing else in the LSP lane may
// interpolate `parameters` (asserted at source level by
// script/m55/verify-signatures.ts).
//
// Declared rules:
//   - the wire keeps the raw structured data (server.ts is untouched): the
//     rendered text is for humans, the columns stay typed for clients;
//   - a type the index never resolved renders the DECLARED unknown marker —
//     never `""`, never `null`, never raw JSON, never a fabricated type;
//   - notation follows the source language where the language HAS the
//     notation (rest/variadic, optional), and never invents syntax a language
//     does not have: an unknown language falls back to the TS/JS spelling,
//     declared here, because that is the notation the repo's own fixtures and
//     the majority of the demo corpora use;
//   - a stored default value renders as the source notation for an optional
//     parameter (`name: T = default`) in every language;
//   - generics are the stored type text, verbatim (no re-parsing, no
//     normalization that could invent or drop a type argument);
//   - a non-JSON `parameters` value is passed through ONLY when it does not
//     carry the raw-JSON shape; anything carrying serialization renders the
//     declared `(…)` absence instead of leaking JSON into the card.

/** Our marker for a type the index did not resolve. Deliberately the word
 *  `unknown`: it asserts nothing about the symbol, and it can never be
 *  mistaken for a type the analyzers stored. */
export const UNRESOLVED_TYPE = "unknown"

/** The rendered form of an unresolvable parameter list (declared absence). */
export const UNKNOWN_PARAMETER_LIST = "…"

/** The raw-JSON shape a rendered signature must NEVER contain. Exported so
 *  the gate can assert every rendered surface against the same regex. */
export const RAW_JSON_SHAPE = /[{\[]\s*"?[A-Za-z_][A-Za-z0-9_]*"?\s*:/ 

/** Symbol types that take a parameter list. A class, a field or a property
 *  never renders `()`: the pre-M55 renderer attached one whenever the column
 *  was non-null, which is not a fact about the symbol. */
const CALLABLE_TYPES: ReadonlySet<string> = new Set([
  "function",
  "method",
  "constructor",
  "procedure",
  "subroutine",
  "getter",
  "setter",
])

export interface SignatureSymbol {
  name: string
  symbol_type: string
  return_type?: string | null
  parameters?: string | null
  visibility?: string | null
}

/** One stored parameter entry, as the analyzers write it. */
export interface ParameterEntry {
  name: string
  type?: string | null
  isOptional?: boolean
  defaultValue?: string | null
  isRest?: boolean
  /** a receiver the source language writes implicitly (`self`, `this`) */
  isImplicit?: boolean
}

export type ParameterShape = "absent" | "empty" | "list" | "opaque" | "serialized"

export interface ParsedParameters {
  shape: ParameterShape
  entries: ParameterEntry[]
  /** the original text, kept for the opaque pass-through case */
  text: string
}

/** Parse the stored `parameters` column into entries, declaring the shape.
 *  Never throws: an unparseable value is `opaque` (passed through only if it
 *  is not serialization) and a JSON value that is not an array is
 *  `serialized` (rendered as the declared absence, never leaked). */
export function parseParameters(raw: string | null | undefined): ParsedParameters {
  if (raw === null || raw === undefined || raw.trim() === "") return { shape: "absent", entries: [], text: "" }
  const text = raw.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { shape: RAW_JSON_SHAPE.test(text) ? "serialized" : "opaque", entries: [], text }
  }
  if (!Array.isArray(parsed)) return { shape: "serialized", entries: [], text }
  if (parsed.length === 0) return { shape: "empty", entries: [], text }
  const entries: ParameterEntry[] = []
  for (const item of parsed) {
    if (typeof item === "string") {
      // A bare name in the array is a stored name with no type.
      if (item.trim() !== "") entries.push({ name: item.trim() })
      continue
    }
    if (item === null || typeof item !== "object") {
      return { shape: "serialized", entries: [], text }
    }      const e = item as Record<string, unknown>
    const name = typeof e.name === "string" ? e.name : ""
    if (name.trim() === "") {
      // An entry without a name cannot be rendered honestly.
      return { shape: "serialized", entries: [], text }
    }
    entries.push({
      name: name.trim(),
      type: typeof e.type === "string" ? e.type : null,
      isOptional: e.isOptional === true || e.optional === true,
      defaultValue: typeof e.defaultValue === "string" ? e.defaultValue : null,
      isRest: e.isRest === true || e.rest === true || e.variadic === true,
      isImplicit: e.isImplicit === true,
    })
  }
  return { shape: "list", entries, text }
}

/** The stored name may carry the source notation of a rest parameter
 *  (`...args`, `*args`). It is declared data, not a guess: the marker is
 *  stripped for rendering and re-applied in the language's notation. */
function splitRestMarker(name: string): { name: string; rest: boolean } {
  if (name.startsWith("...")) return { name: name.slice(3), rest: true }
  if (name.startsWith("*") && name.length > 1) return { name: name.slice(1), rest: true }
  return { name, rest: false }
}

function resolvedType(type: string | null | undefined): string {
  const t = (type ?? "").trim()
  return t === "" ? UNRESOLVED_TYPE : t
}

/**
 * Render one parameter in the source language's notation. The language is a
 * declared input; when it is unknown or absent, the TS/JS spelling is used
 * (declared fallback, see the header).
 */
export function renderParameter(entry: ParameterEntry, language: string | null): string {
  const marked = splitRestMarker(entry.name)
  const rest = entry.isRest === true || marked.rest
  const name = marked.name
  const type = resolvedType(entry.type)
  const lang = (language ?? "").toLowerCase()
  const trailingDefault = entry.defaultValue !== null && entry.defaultValue !== undefined && entry.defaultValue !== "" ? ` = ${entry.defaultValue}` : ""

  if (rest) {
    if (lang === "python") return `*${name}: ${type}`
    if (lang === "java") return `${type}... ${name}`
    if (lang === "kotlin") return `vararg ${name}: ${type}`
    if (lang === "scala") return `${name}: ${type}*`
    return `...${name}: ${type}`
  }
  // An implicit receiver (`self` in python, `this` elsewhere) is never
  // annotated in the source language — rendering the unknown marker for it
  // would assert a type the source does not write. The bare name IS the
  // source notation (declared rule).
  if (entry.isImplicit === true) return name
  // Optionality is rendered only where the language HAS the notation for it;
  // a stored default value is the notation every analyzed language shares.
  if (lang === "java") return trailingDefault !== "" ? `${type} ${name}${trailingDefault}` : `${type} ${name}`
  if (entry.isOptional === true && trailingDefault === "") {
    // `?` is optionality in TS/JS only. For the other languages the flag has
    // no source notation — the parameter renders plainly rather than in
    // invented syntax, and the gate records that as a declared limitation.
    if (lang === "javascript" || lang === "typescript" || lang === "" || lang === "unknown") return `${name}?: ${type}`
    return `${name}: ${type}`
  }
  return `${name}: ${type}${trailingDefault}`
}

/**
 * The ONE parameter-list renderer. Returns the text INSIDE the parentheses:
 *   `names: string[]`, `name?: string`, `...rest: number[]`,
 *   `key: string, value: T | undefined`, `…` (declared unknown).
 */
export function renderParameterList(raw: string | null | undefined, language: string | null): string {
  const parsed = parseParameters(raw)
  switch (parsed.shape) {
    case "absent":
      return UNKNOWN_PARAMETER_LIST
    case "empty":
      return ""
    case "list":
      return parsed.entries.map((e) => renderParameter(e, language)).join(", ")
    case "opaque":
      return parsed.text
    case "serialized":
      // Structured data we cannot attribute to a parameter: the declared
      // absence, never the serialization.
      return UNKNOWN_PARAMETER_LIST
  }
}

/** The ONE signature renderer: `<visibility> <type> <name>(<params>) → <ret>`.
 *  A callable ALWAYS renders a parameter list (declared absence `(…)` when the
 *  index stores none); other kinds render no parentheses. */
export function renderSignature(symbol: SignatureSymbol, language: string | null): string {
  const parts: string[] = []
  const visibility = (symbol.visibility ?? "").trim()
  if (visibility !== "") parts.push(visibility)
  parts.push(symbol.symbol_type)
  // A constructor's stored name is the word `constructor` too (every analyzer
  // that stores one): rendering the type and the name would read
  // `constructor constructor(...)`. The type is the identity here — repeat it
  // only when it is not the name.
  let sig = symbol.symbol_type.toLowerCase() === symbol.name.toLowerCase() ? parts.join(" ") : `${parts.join(" ")} ${symbol.name}`
  const type = (symbol.symbol_type ?? "").toLowerCase()
  if (CALLABLE_TYPES.has(type)) {
    sig += `(${renderParameterList(symbol.parameters, language)})`
  }
  const ret = (symbol.return_type ?? "").trim()
  if (ret !== "") sig += ` → ${ret}`
  return sig
}

/** True when `text` carries raw serialization — the gate's assertion, shared
 *  with the renderer's own opaque-input guard. */
export function carriesRawJson(text: string): boolean {
  return RAW_JSON_SHAPE.test(text)
}
