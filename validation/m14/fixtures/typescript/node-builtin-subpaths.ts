// Node builtins are RUNTIME modules, not npm packages — including the subpath
// forms Node's own spec defines. The bare-name set the analyzer carried
// predates them, so `node:fs/promises`, `node:test`, `stream/promises`,
// `readline/promises`, `timers/promises`, `util/types`, `assert/strict` and
// `path/posix` all fell through to `external:<specifier>`: the index reported
// a dependency on packages named "fs/promises" and "test" in every modern Node
// codebase, and a consumer classifying externals saw runtime imports as
// third-party code.
//
// Authored BEFORE the analyzer run: the pre-fix classification was measured by
// probe first (every subpath above resolved to `external:…`), and these pins
// encode Node's documented classification, not the observed output.
import fs from "node:fs"
import fsp from "node:fs/promises"
import { test } from "node:test"
import { Readable } from "stream/promises"
import { createInterface } from "node:readline/promises"
import { setTimeout as delay } from "timers/promises"
import type { InspectOptions } from "util/types"
import assert from "assert/strict"
import posix from "path/posix"

// CONTROLS: a real package, a package SUBPATH (which is NOT a builtin), and
// relative specifiers. `lodash/merge` is the anti-pollution case: it has the
// same shape as a builtin subpath and must stay external.
import express from "express"
import merge from "lodash/merge"
import { helper } from "./local-helper"

export function readAll(path: string): Promise<Buffer> {
  return fsp.readFile(path)
}

export function readSync(path: string): Buffer {
  return fs.readFileSync(path)
}

export function joinRoot(a: string, b: string): string {
  return posix.join(a, b)
}

export function describeOptions(o: InspectOptions): string {
  return JSON.stringify(o)
}

export function runSuite(): void {
  test("suite", () => {
    assert.equal(typeof delay, "function");
  });
}

export async function consume(): Promise<string> {
  const rs = new Readable({ read() {} });
  for await (const chunk of rs) void chunk;
  return helper();
}

export function serve(): unknown {
  return express();
}

export function deepMerge(a: unknown, b: unknown): unknown {
  return merge(a, b);
}
