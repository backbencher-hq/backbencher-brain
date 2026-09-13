// script/m44/u6-fixture.ts — M44.U6 fixture (F7: authored BEFORE the fix).
//
// The H2 fixture renders exactly MAX_USAGE_LINKS (3) usage sites, so the
// "+N more — show all usages" escape hatch never appears there. U6 needs a
// hover whose usages section EXCEEDS the top-3 to prove the upgraded link
// (symbol in the args) end-to-end over the real server — so this fixture
// gives `render` FIVE call sites across three files.
//
// Exercised facts:
//   - hover on render → **usages** section renders top-3 links PLUS
//     "+2 more — [show all usages](command:bb.showAllUsages?...)";
//   - the link args carry {file, line, character, symbol:"render"} — the
//     SERVER-RESOLVED identity (no client-side guessing, issue #652 rule);
//   - the location equals the stored declaration (the definition link's
//     target), matching H4's identity law.

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

export const U6_ROOT = path.resolve(import.meta.dirname, "../../.tools/m44-u6-fixture")

export const U6_REL = {
  app: "src/main/java/com/demo/App.java",
  extra1: "src/main/java/com/demo/Extra1.java",
  extra2: "src/main/java/com/demo/Extra2.java",
} as const

export const U6_SOURCE_APP = `package com.demo;

public class App {
    public static void main(String[] args) {
        Greeter g = new Greeter();
        g.render();
    }
}

class Greeter {
    public String render() {
        return "greeter";
    }
}

class ExtraCalls {
    void both() {
        Greeter g = new Greeter();
        g.render();
        g.render();
    }
}
`

function callerSource(className: string): string {
  return `package com.demo;

public class ${className} {
    public static void main(String[] args) {
        new Greeter().render();
    }
}
`
}

export const U6_SOURCE_EXTRA1 = callerSource("Extra1")
export const U6_SOURCE_EXTRA2 = callerSource("Extra2")

/** 0-based LSP positions derived from the fixture text (never hand-picked). */
function declLine(source: string, needle: string): number {
  const i = source.split("\n").findIndex((l) => l.includes(needle))
  if (i === -1) throw new Error(`u6 fixture: line "${needle}" not found`)
  return i
}

export const U6_EXPECT = {
  renderDeclLine: declLine(U6_SOURCE_APP, "public String render()"),
  renderDeclChar: U6_SOURCE_APP.split("\n")[declLine(U6_SOURCE_APP, "public String render()")]!.indexOf("render"),
  // FOUR usage sites: App.main, ExtraCalls.both (twice — one site after the
  // location dedup), Extra1.main, Extra2.main. The usages section shows the
  // top-3 links + "+1 more". (Pre-M55 the count was 5 because render's own
  // owning class `contains` row was offered as a usage — M55.T3, §14 Truth
  // Rule 1: a declaration is never a usage.)
  shownLinks: 3,
  hiddenMore: 1,
  symbol: "render",
} as const

export function writeU6Fixture(): string {
  for (const rel of Object.values(U6_REL)) {
    const file = path.join(U6_ROOT, rel)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(
      file,
      rel === U6_REL.app ? U6_SOURCE_APP : rel === U6_REL.extra1 ? U6_SOURCE_EXTRA1 : U6_SOURCE_EXTRA2,
    )
  }
  return U6_ROOT
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("fixture written:", writeU6Fixture())
}
