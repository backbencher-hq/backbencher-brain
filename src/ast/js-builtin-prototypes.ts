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

/**
 * JS HOST GLOBALS — the CLOSED, CITED list a `uses`/`calls` target may be claimed EXTERNAL with.
 *
 * WHY THIS EXISTS. The javascript lane's unresolved `uses` and `calls` rows are dominated by names the file
 * does not declare and CANNOT declare: the platform's own global object and its members. Before this list the
 * analyzer published those rows with NO claim at all, so they read as `unresolved` and cannot be told apart
 * from a name the project failed to bind. A claim fixes the READ, not the binding — `isExternalTarget` says
 * "this target is outside the project", and it never picks a declaration, so it cannot raise `arbitraryTwin`
 * or `bindFAIL`.
 *
 * THE DISCIPLINE, AND IT IS THE POINT: **a name not in this list gets NO claim.** A heuristic ("looks like a
 * DOM name") would be the very "closed list" lie this fleet keeps catching itself violating. The citation
 * beside each entry IS the list's proof: every name below is a property of the ECMAScript global object or a
 * member of the HTML `Window` / Web IDL `WindowOrWorkerGlobalScope` surface, at the section named.
 *
 * CITED SOURCES:
 *   ECMA-262 §19–§26  — the global object's own properties (value, function and constructor properties).
 *   WHATWG HTML §7.3  — the `Window` interface and `WindowOrWorkerGlobalScope` mixin (`document`, `window`,
 *                       `console`, `location`, `navigator`, `fetch`, timers, storage, …).
 *   Web IDL           — `WindowOrWorkerGlobalScope` (the mixin itself; its members are listed under HTML §7.3).
 *
 * KEPT SEPARATE FROM `JS_BUILTIN_CHAINS` ON PURPOSE: that table answers "what members does this BUILTIN TYPE
 * have" for override resolution; this one answers "is this bare name an EXTERNAL GLOBAL". Folding them would
 * make one table serve two questions and lose the ability to cite either.
 */
const HOST_GLOBALS: Readonly<Record<string, string>> = {
  // WHATWG HTML §7.3 — the Window interface and its members.
  window: "WHATWG HTML §7.3 Window",
  document: "WHATWG HTML §7.3 Window",
  console: "WHATWG HTML §7.3 Window.console",
  location: "WHATWG HTML §7.3 Window.location",
  navigator: "WHATWG HTML §7.3 Window.navigator",
  history: "WHATWG HTML §7.3 Window.history",
  screen: "WHATWG HTML §7.3 Window.screen",
  localStorage: "WHATWG HTML §7.3 WindowOrWorkerGlobalScope.localStorage",
  sessionStorage: "WHATWG HTML §7.3 WindowOrWorkerGlobalScope.sessionStorage",
  fetch: "WHATWG HTML §7.3 WindowOrWorkerGlobalScope.fetch",
  setTimeout: "WHATWG HTML §7.3 WindowOrWorkerGlobalScope.setTimeout",
  clearTimeout: "WHATWG HTML §7.3 WindowOrWorkerGlobalScope.clearTimeout",
  setInterval: "WHATWG HTML §7.3 WindowOrWorkerGlobalScope.setInterval",
  clearInterval: "WHATWG HTML §7.3 WindowOrWorkerGlobalScope.clearInterval",
  requestAnimationFrame: "WHATWG HTML §7.3 Window.requestAnimationFrame",
  cancelAnimationFrame: "WHATWG HTML §7.3 Window.cancelAnimationFrame",
  alert: "WHATWG HTML §7.3 Window.alert",
  confirm: "WHATWG HTML §7.3 Window.confirm",
  prompt: "WHATWG HTML §7.3 Window.prompt",
  atob: "WHATWG HTML §7.3 WindowOrWorkerGlobalScope.atob",
  btoa: "WHATWG HTML §7.3 WindowOrWorkerGlobalScope.btoa",
  queueMicrotask: "WHATWG HTML §7.3 WindowOrWorkerGlobalScope.queueMicrotask",
  structuredClone: "WHATWG HTML §7.3 WindowOrWorkerGlobalScope.structuredClone",
  performance: "WHATWG HTML §7.3 Window.performance",
  customElements: "WHATWG HTML §7.3 Window.customElements",
  // ECMA-262 §19–§26 — the global object's own properties.
  globalThis: "ECMA-262 §19.1 globalThis",
  JSON: "ECMA-262 §25.5 JSON",
  Math: "ECMA-262 §21.3 Math",
  Object: "ECMA-262 §20.1 Object",
  Array: "ECMA-262 §23.1 Array",
  String: "ECMA-262 §22.1 String",
  Number: "ECMA-262 §21.1 Number",
  Boolean: "ECMA-262 §20.3 Boolean",
  Date: "ECMA-262 §21.4 Date",
  RegExp: "ECMA-262 §22.2 RegExp",
  Promise: "ECMA-262 §27.2 Promise",
  Map: "ECMA-262 §24.1 Map",
  Set: "ECMA-262 §24.2 Set",
  WeakMap: "ECMA-262 §24.3 WeakMap",
  WeakSet: "ECMA-262 §24.4 WeakSet",
  Symbol: "ECMA-262 §20.4 Symbol",
  Proxy: "ECMA-262 §28.2 Proxy",
  Reflect: "ECMA-262 §28.1 Reflect",
  Error: "ECMA-262 §20.5 Error",
  TypeError: "ECMA-262 §20.5.6 TypeError",
  RangeError: "ECMA-262 §20.5.5 RangeError",
  parseInt: "ECMA-262 §19.2.5 parseInt",
  parseFloat: "ECMA-262 §19.2.4 parseFloat",
  isNaN: "ECMA-262 §19.2.3 isNaN",
  isFinite: "ECMA-262 §19.2.2 isFinite",
  encodeURIComponent: "ECMA-262 §19.2.6 encodeURIComponent",
  decodeURIComponent: "ECMA-262 §19.2.7 decodeURIComponent",
  encodeURI: "ECMA-262 §19.2.8 encodeURI",
  decodeURI: "ECMA-262 §19.2.9 decodeURI",
  NaN: "ECMA-262 §6.1.6 NaN",
  Infinity: "ECMA-262 §6.1.6 Infinity",
  undefined: "ECMA-262 §6.1.1 undefined",
}

/**
 * The citation for a bare name that is an EXTERNAL platform global, or `null` when it is not on the cited list.
 *
 * Returns the CITATION, not a boolean, because the caller publishes it as the claim's stated reason — a claim
 * without its citation is prose, and this programme does not accept prose as a claim.
 */
export function hostGlobalCitation(name: string): string | null {
  return HOST_GLOBALS[name] ?? null
}

/** The closed list itself, for callers that must show what the vocabulary contains. */
export function isHostGlobal(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(HOST_GLOBALS, name)
}
