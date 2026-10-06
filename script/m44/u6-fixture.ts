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
//   - the header's total is 5 = the three shown + the two the hatch stands
//     for (§13.4 — the header counts what the eye can verify);
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
  // FIVE usage PLACES, shown as the top-3 links + "+2 more".
  //
  // The rows in the store (measured, not asserted): six incoming rows, of
  // which one is `Greeter contains render` — a DECLARATION, filtered out by
  // the vocabulary owner src/lsp/relations.ts (§14 Truth Rule 1, M55.T3). Five
  // are `calls`, and a call is counted once per PLACE (the unit label the
  // header prints verbatim): App.java:6 (main), App.java:19 and App.java:20
  // (ExtraCalls.both — TWO call sites on TWO lines), Extra1.java:5, and
  // Extra2.java:5.
  //
  // WHY THIS NUMBER MOVED, and which law now governs. It was 4 ("+1 more"),
  // and the reason it was 4 is that M62 §2 made `brain_relationship.line_number`
  // a REAL call-site line and every surface now serves it. The two
  // ExtraCalls.both rows used to dedupe to ONE place because both served the
  // CALLER'S DECLARATION (ExtraCalls.both at App.java:17) — under §14 rule 3
  // ("positions are where the thing is") that was the old defect, not the
  // truth: two calls on two lines are two places, and a caret cannot be put
  // in two places at once. The count that followed from the old key was a
  // lie that happened to be small.
  //
  // The law that governs today is §13.4 with §14 rule 3: the header counts
  // what the eye can verify, and each row opens the stored call site. Five
  // places, three rendered, two behind the declared escape hatch. §13.6 is
  // unaffected — the hatch still opens the hub, never a message.
  shownLinks: 3,
  hiddenMore: 2,
  /** The header's own total, so §13.4 is checked against the fixture's
   *  arithmetic rather than against a second hand-written number. */
  totalPlaces: 5,
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
