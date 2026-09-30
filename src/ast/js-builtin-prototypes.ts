/**
 * J9 (2026-09-30): the PROTOTYPE CHAINS and MEMBERS of the platform builtins that
 * JavaScript code extends.
 *
 * WHY THIS IS A MODULE AND NOT A TABLE IN EITHER SIDE. The analyzer and the
 * differential's oracle both need it, and they must AGREE: an oracle carrying its
 * own copy would be able to drift from the analyzer without anything noticing,
 * which is the shared-premise failure this whole investigation kept running into
 * (X1 was two implementations of one wrong rule agreeing perfectly). One declaration,
 * imported by both, is the only version of "they agree" that means anything.
 *
 * WHY IT IS NEEDED AT ALL. A base class that no corpus declares has no members
 * anything can discover — `URLSearchParams`'s prototype is in no repository here.
 * So the members are PLATFORM KNOWLEDGE, declared rather than derived, and that is
 * the weakest input in the chain: a wrong entry produces a confidently wrong
 * verdict. It is stated rather than hidden because of that.
 *
 * WHY CHAINS AND NOT FLAT LISTS. Overriding works through inheritance, so a member
 * of any ancestor counts. `HTMLElement` is five prototypes deep — `addEventListener`
 * is three hops away on `EventTarget.prototype` and is still a member of
 * `HTMLElement`. A flat per-type list got that wrong, and the symptom was a claim
 * that all six `HTMLElement.*` override rows were false when two of them are true.
 * That correction is why this file is shaped the way it is.
 *
 * MEASURED, over the full 3,369-file svelte corpus, with the table applied on the
 * ANALYZER side: 37 of 44 emitted override rows are confirmed against these
 * members and 7 are not — the 3 custom-element callbacks
 * (`connectedCallback`, `disconnectedCallback`, `attributeChangedCallback`),
 * `$$g_p`, the template marker `[REPLACE]`, and `toJSON` on `Error` and `URL`.
 * That 84% figure is the reason J9 part 2 was decided by measurement: suppressing
 * the whole first-parent guess would have deleted 37 correct rows to remove 7 wrong
 * ones, so the guess stays and the table is used to remove only what is provably
 * not a member.
 */

/** Chains are listed outermost-first; a member of ANY link counts. */
export const JS_BUILTIN_CHAINS: Record<string, readonly string[]> = {
  Map: ["Map", "Object"],
  Set: ["Set", "Object"],
  WeakMap: ["WeakMap", "Object"],
  WeakSet: ["WeakSet", "Object"],
  Promise: ["Promise", "Object"],
  Array: ["Array", "Object"],
  String: ["String", "Object"],
  Number: ["Number", "Object"],
  Boolean: ["Boolean", "Object"],
  Error: ["Error", "Object"],
  TypeError: ["TypeError", "Error", "Object"],
  RangeError: ["RangeError", "Error", "Object"],
  Date: ["Date", "Object"],
  RegExp: ["RegExp", "Object"],
  JSON: ["JSON", "Object"],
  Reflect: ["Reflect", "Object"],
  URL: ["URL", "Object"],
  URLSearchParams: ["URLSearchParams", "Object"],
  Object: ["Object"],
  HTMLElement: ["HTMLElement", "Element", "Node", "EventTarget", "Object"],
  Element: ["Element", "Node", "EventTarget", "Object"],
  Node: ["Node", "EventTarget", "Object"],
  EventTarget: ["EventTarget", "Object"],
}

const MEMBERS: Record<string, readonly string[]> = {
  Map: ["clear", "delete", "entries", "forEach", "get", "has", "keys", "set", "values", "size", "[Symbol.iterator]"],
  Set: ["add", "clear", "delete", "entries", "forEach", "has", "keys", "size", "values", "[Symbol.iterator]"],
  WeakMap: ["delete", "get", "has", "set"],
  WeakSet: ["add", "delete", "has"],
  Promise: ["all", "allSettled", "any", "catch", "finally", "race", "reject", "resolve", "then"],
  Array: ["at", "concat", "copyWithin", "entries", "every", "fill", "filter", "find", "findIndex", "flat", "flatMap", "forEach", "includes", "indexOf", "join", "keys", "lastIndexOf", "length", "map", "pop", "push", "reduce", "reduceRight", "reverse", "shift", "slice", "some", "sort", "splice", "toString", "unshift", "values", "[Symbol.iterator]"],
  String: ["at", "charAt", "charCodeAt", "codePointAt", "concat", "endsWith", "includes", "indexOf", "lastIndexOf", "length", "localeCompare", "match", "normalize", "padEnd", "padStart", "repeat", "replace", "replaceAll", "search", "slice", "split", "startsWith", "substring", "toLowerCase", "toString", "toUpperCase", "trim", "trimEnd", "trimStart"],
  Number: ["toExponential", "toFixed", "toPrecision", "toString", "valueOf"],
  Boolean: ["toString", "valueOf"],
  Error: ["cause", "message", "name", "stack", "toString"],
  Date: ["getDate", "getDay", "getFullYear", "getHours", "getMilliseconds", "getMinutes", "getMonth", "getSeconds", "getTime", "getTimezoneOffset", "getUTCDate", "getUTCDay", "getUTCFullYear", "getUTCHours", "setDate", "setFullYear", "setHours", "setMinutes", "setMonth", "setSeconds", "setTime", "toISOString", "toJSON", "toLocaleDateString", "toLocaleString", "toLocaleTimeString", "toString", "toUTCString", "valueOf"],
  RegExp: ["exec", "flags", "global", "lastIndex", "source", "test", "toString"],
  JSON: ["parse", "stringify"],
  Reflect: ["apply", "construct", "defineProperty", "deleteProperty", "get", "getOwnPropertyDescriptor", "getPrototypeOf", "getOwnPropertyDescriptor", "has", "isExtensible", "ownKeys", "preventExtensions", "set", "setPrototypeOf"],
  URL: ["hash", "href", "host", "hostname", "origin", "password", "pathname", "port", "protocol", "search", "searchParams", "toJSON", "toString", "username"],
  URLSearchParams: ["append", "delete", "entries", "forEach", "get", "getAll", "has", "keys", "set", "size", "sort", "toString", "values", "[Symbol.iterator]"],
  Object: ["assign", "create", "defineProperty", "entries", "freeze", "fromEntries", "getOwnPropertyDescriptor", "getOwnPropertyNames", "getPrototypeOf", "hasOwn", "hasOwnProperty", "is", "isFrozen", "isSealed", "keys", "preventExtensions", "propertyIsEnumerable", "seal", "setPrototypeOf", "toString", "valueOf"],
  HTMLElement: ["attachShadow", "blur", "click", "closest", "focus", "getAttribute", "getBoundingClientRect", "getClientRects", "getElementsByClassName", "getElementsByTagName", "hidden", "id", "innerHTML", "innerText", "matches", "remove", "removeAttribute", "scrollIntoView", "setAttribute", "shadowRoot", "style", "tagName", "textContent", "title"],
  Element: ["closest", "getAttribute", "getAttributeNames", "hasAttribute", "matches", "removeAttribute", "setAttribute", "tagName"],
  Node: ["appendChild", "childNodes", "cloneNode", "contains", "insertBefore", "nodeName", "nodeType", "parentNode", "removeChild", "replaceChild", "textContent"],
  EventTarget: ["addEventListener", "removeEventListener", "dispatchEvent"],
}

const MEMBER_SETS: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries(MEMBERS).map(([k, v]) => [k, new Set(v)]),
)

/** Is `base` a platform builtin this module knows how to resolve? */
export function isJsBuiltin(base: string): boolean {
  return Object.prototype.hasOwnProperty.call(JS_BUILTIN_CHAINS, base)
}

/**
 * Is `member` a member of `base` ANYWHERE on its prototype chain?
 *
 * `member` is the PUBLISHED name, so a `#private` field has already been stripped by
 * the caller: `#x` is class-scoped and is never a prototype member, which is a
 * different rule and is enforced where the name is still private.
 */
export function jsBuiltinHasMember(base: string, member: string): boolean {
  const chain = JS_BUILTIN_CHAINS[base]
  if (!chain) return false
  for (const link of chain) {
    const set = MEMBER_SETS[link]
    if (set && set.has(member)) return true
  }
  return false
}
