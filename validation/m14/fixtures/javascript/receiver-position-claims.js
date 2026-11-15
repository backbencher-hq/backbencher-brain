// RECEIVER-POSITION CLAIM EVIDENCE — a MEMBER call whose receiver chain is PURE and rooted at a file
// IMPORT binding. The row's target stays the member leaf; the evidence is `{specifier, binding}` from
// the file's own imports rows (the arbiter verifies the claim against that evidence, never the use
// edge's word). Refused: bare imported callees (the importedBinding class), chains through CALL
// results, computed subscripts, and roots that are not import bindings.

import path from "path";
import * as fs from "fs";
import { config } from "tseslint";
import Route from "react-router";
import relCfg from "./rel-config.js";

const req = require("pathlib");
const dynamicName = "dyn";

export function defaultImportReceiver() {
  return path.join("a", "b");
}

export function namespaceReceiver() {
  return fs.readFileSync("x");
}

export function namedImportReceiver() {
  return Route.push("/home");
}

export function pureMemberChain() {
  return config.config.rules();
}

export function requireReceiver() {
  return req.join("x");
}

// NEGATIVE: a LOCAL receiver (class instance) — no receiver-position evidence.
class LocalService {
  run() {
    return 1;
  }
}
export function localReceiver() {
  const svc = new LocalService();
  return svc.run();
}

// NEGATIVE: a PARAMETER receiver — not an import binding.
export function paramReceiver(thing) {
  return thing.run();
}

// NEGATIVE: a CALL-RESULT receiver — the receiver is the call result, not the namespace.
export function callResultReceiver() {
  return path.resolve().customThing();
}

// NEGATIVE: a RELATIVE receiver — project-internal import, member is project-resolvable, so the
// EXTERNAL-ONLY restriction leaves it unmarked (claiming it would launder a resolvable edge).
export function relativeReceiver() {
  return relCfg.load();
}

// NEGATIVE: a DYNAMIC specifier binding — imported, but with no evidence entry, so it can never claim.
export function dynamicRequireReceiver() {
  const dyn = require(dynamicName);
  return dyn.go();
}
