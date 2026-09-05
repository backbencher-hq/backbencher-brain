// script/m42/h2-fixture.ts — M42.H2 fixture (F7: authored BEFORE the wiring).
//
// The fixture exercises the rich-hover sections over REAL analyzer output:
//   - `render` (unique method name): called from TWO files by two `main`
//     methods — exercises "called by" plus same-name disambiguation — and
//     contained by its class.
//   - `Greeter implements Named` — exercises the "implements" verb.
//   - `instantiates` rows from both callers — "instantiated by".
//
// Fixture-shape note (learned by indexing, frozen here): the java analyzer
// resolves method names to the FIRST symbol with that name, so an @Override
// impl next to its interface method links the override to the interface
// method (a same-name collision) and orphans the impl. This fixture
// therefore uses a marker interface + unique method names — the rows below
// are the analyzer's actual output on this shape.
//
// Expectations are DERIVED from the fixture source (0-based lines) — never
// hand-picked constants — and must equal the analyzer's own line_start rows
// (verified by script/m42/verify-rich-hover.ts R2).

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

export const H2_ROOT = path.resolve(import.meta.dirname, "../../.tools/m42-h2-fixture")
export const H2_REL_APP = "src/main/java/com/demo/App.java"
export const H2_REL_MAIN2 = "src/main/java/com/demo/Main2.java"
export const H2_FILE_APP = path.join(H2_ROOT, H2_REL_APP)
export const H2_FILE_MAIN2 = path.join(H2_ROOT, H2_REL_MAIN2)

export const H2_SOURCE_APP = `package com.demo;

interface Named {
}

class Greeter implements Named {
    public String render() {
        return "greeter";
    }
}

public class App {
    public static void main(String[] args) {
        Greeter greeter = new Greeter();
        String s = greeter.render();
        System.out.println(s);
    }
}
`

export const H2_SOURCE_MAIN2 = `package com.demo;

public class Main2 {
    public static void main(String[] args) {
        Greeter g = new Greeter();
        g.render();
    }
}
`

export function writeH2Fixture(): string {
  mkdirSync(path.dirname(H2_FILE_APP), { recursive: true })
  mkdirSync(path.dirname(H2_FILE_MAIN2), { recursive: true })
  writeFileSync(H2_FILE_APP, H2_SOURCE_APP)
  writeFileSync(H2_FILE_MAIN2, H2_SOURCE_MAIN2)
  return H2_ROOT
}

const appLines = H2_SOURCE_APP.split("\n")
const main2Lines = H2_SOURCE_MAIN2.split("\n")

function indexOf(ls: string[], needle: string): number {
  const i = ls.findIndex((l) => l.includes(needle))
  if (i === -1) throw new Error(`h2 fixture: line "${needle}" not found`)
  return i
}

// 0-based LSP lines of the fixture source (analyzer rows use the same
// convention on this shape — no annotations shift lines).
const greeterDeclLine = indexOf(appLines, "class Greeter")
const renderDeclLine = indexOf(appLines, "public String render()")
const appMainDeclLine = indexOf(appLines, "static void main")
const namedDeclLine = indexOf(appLines, "interface Named")
const main2MainDeclLine = indexOf(main2Lines, "static void main")

export const H2_EXPECT = {
  // --- hover target 1: Greeter.render (unique name) ---
  render: {
    file: H2_REL_APP,
    declLine: renderDeclLine, // cursor on the declaration
    declText: "public String render()",
    // connected summary: called by main (App) and main (Main2.java) —
    // same name, two files: the second MUST render disambiguated.
    callerNames: ["main", "main"],
    callerFiles: [H2_REL_APP, H2_REL_MAIN2],
    callerLines: [appMainDeclLine, main2MainDeclLine],
    // contained by its class (a usage row, but NOT a connection fact).
    containerName: "Greeter",
    containerLine: greeterDeclLine,
  },
  // --- hover target 2: Greeter class ---
  greeter: {
    file: H2_REL_APP,
    declLine: greeterDeclLine,
    // connected summary: implements Named + instantiated by main (both).
    implementsName: "Named",
    implementsLine: namedDeclLine,
    instantiatorNames: ["main", "main"],
  },
  // --- definition link anchors ---
  renderDefFile: H2_REL_APP,
  renderDefLine: renderDeclLine,
  greeterDefLine: greeterDeclLine,
  // Every usage link target must equal a location the L3 references surface
  // returns for the same position (differential honesty).
  differentialFile: H2_REL_APP,
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("fixture written:", writeH2Fixture())
}
