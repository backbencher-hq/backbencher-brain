// IMPORTED-BINDING CLAIMS — the EVIDENCE-VERIFIED claim kind (Lead contract 2026-10-18).
//
// On an edge targeting a name this file's import / require() binds, the analyzer publishes
// metadata.importedBinding = { specifier, binding } and KEEPS THE TARGET BARE (no separator: this
// claim is verified by the arbiter against the run's own imports edges, not by a spelling). The
// imports edges themselves carry the evidence: metadata.importedBindings = the local names each
// import binds.
//
// POSITIVE: named import call · default import call · namespace local read · aliased import call ·
// require destructure call · bare require binding read.
// NEGATIVE (must stay bare and unclaimed): a name THIS FILE declares (no import evidence); a
// namespace MEMBER access (the target is a member, not the import binding); a DYNAMIC specifier
// (no literal evidence, so the binding can never be claimed).

import debounce from "lodash";
import { throttle } from "lodash";
import * as ns from "lodash";
import { draw as render } from "./m2";

export function usesNamed() {
  return throttle();
}

export function usesDefault() {
  return debounce();
}

export function usesNamespace() {
  const local = ns;
  return local;
}

export function usesAlias() {
  return render();
}

export function usesRequire() {
  const { readFile } = require("fs");
  return readFile();
}

export function usesRequireBare() {
  const fsMod = require("fs");
  return fsMod;
}

// NEGATIVE (a): a name the FILE declares — no import binds it, so no imported claim.
function localOnly() {
  return 1;
}

export function callsLocal() {
  return localOnly();
}

// NEGATIVE (b): namespace MEMBER access — `foo` is a member, not the import binding `ns`.
export function callsNamespaceMember() {
  return ns.foo();
}

// NEGATIVE (c): dynamic specifier — no literal evidence, so the binding can never be claimed.
export function dynamicRequire(moduleName) {
  const dyn = require(moduleName);
  return dyn();
}
