#!/usr/bin/env bun
/**
 * THE SHAPE-AGREEMENT SCANNER (Lead, 2026-10-22).
 *
 * ★ WHY THIS EXISTS. THREE TIMES IN ONE DAY THE FLEET FOUND THE SAME SHAPE IN THE LEAD'S OWN
 * FILES, and the yaml lane ASKED for the instrument that would have found the third:
 *
 *   1. THE OPERATOR-NAME CLASS was tested in TWO PLACES in `src/ast/pool-worker.ts`, and the Lead
 *      extended ONE of them. The other was left alone, so 7 RUBY `[]=` SETTER ROWS STAYED DROPPED
 *      — while the Lead's own COMMIT MESSAGE said `[]=` "was already exempt as an operator name",
 *      and the Lead's own COMMENT at the other site LISTS `[]` AND `[]=` AMONG RUBY'S LEGAL
 *      OPERATOR NAMES. The comment was RIGHT ABOUT THE LANGUAGE and WRONG ABOUT THE CODE.
 *   2. THE BEAT-DAEMON'S LAUNCH was duplicated in two places in `script/m14/arm-token.sh`, and the
 *      copy still used a RELATIVE `"$0"` — so a daemon started from a lane's own working directory
 *      could not find its own script. **A PATH THAT WAS NEVER RUN FROM ELSEWHERE IS A WISH.**
 *   3. THE EXTENSION MAP was duplicated: the Lead's heritage probe carried its own, and it had NO
 *      `cpp` entry — so the probe measured an EMPTY POPULATION and printed a clean-looking zero
 *      with exit 0. **A TABLE DUPLICATED IN TWO PLACES IS ONE TABLE THAT WILL DIVERGE.**
 *
 * ⇒ ⇒ ⇒ ALL THREE ARE ONE SHAPE: **A THING COPIED IN TWO PLACES IS ONE THING THAT WILL BE FIXED IN
 * ONE PLACE ONLY.** And the yaml lane's finding was the same shape a third time over — the ruby
 * leaf shape, the yaml block scalar, and the differential's truth-side name test — which is why it
 * ASKED for an instrument that finds EVERY SITE OF A SHAPE AT ONCE.
 *
 * ★ ⇒ ⇒ ⇒ BUT A GREP IS NOT THAT INSTRUMENT. A grep finds the SITES. It does not say whether the
 * sites AGREE — and the whole failure in all three cases was that the sites DISAGREED while both
 * looked right. ⇒ ⇒ ⇒ **THIS INSTRUMENT EXTRACTS THE SHAPE FROM EVERY SITE AND COMPARES THE
 * EXTRACTED VALUES.** That is the same discipline the Lead's config-drift check already uses on the
 * heritage probe ("the analyzer's own source names every node type this probe's table names — the
 * table and the analyzer AGREE"), lifted to a registry so it covers the fleet instead of one file.
 *
 * ★ ⇒ ⇒ ⇒ AND THE OTHER THING A GREP CANNOT DO IS COUNT. A shape that SHOULD EXIST IN EXACTLY ONE
 * PLACE — a launch site, a table — is a shape whose site COUNT is the measurement, and a count is
 * not a grep's output.
 *
 * ★ ⇒ ⇒ ⇒ AND THE INSTRUMENT IS ITSELF SUBJECT TO THE FLEET'S RULES, WHICH IS WHY IT IS HERE. Its
 * first two shapes were wrong on its first run: the operator-name shape matched NOTHING (a false
 * NEGATIVE — a shape that finds no site is a shape that cannot report a disagreement), and the
 * extension shape matched 969 sites, most of them in the vendored tree-sitter grammars, which is not
 * a shape at all. ⇒ ⇒ ⇒ **A SHAPE THAT MATCHES THE WORLD IS NOT A SHAPE**, and **A SHAPE THAT FINDS
 * NOTHING CANNOT REPORT A DISAGREEMENT**. Both were fixed by making the shape specific and the SCOPE
 * explicit: the scanner reads THE FLEET'S OWN CODE, because **A SHAPE IN A VENDORED TREE IS NOT A
 * COPY OF THIS FLEET'S SHAPE**.
 *
 * RUN:   bun script/m14/shape-agreement-scan.ts [--shape=<id>] [--list]
 *
 * EXIT:  0 when every registered shape agrees and every expected site count holds.
 *        5 when a shape's sites DISAGREE, when a shape has the wrong NUMBER of sites, or when a
 *        shape's site is in a file that is not allowed to hold it.
 *        3 on a usage error.
 */

import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve, relative } from "node:path"
import { FLEET_LANES } from "./language-extensions"

const ROOT = resolve(import.meta.dir, "../..")

const argv = process.argv.slice(2)
const argOf = (name: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const ONLY = argOf("shape")
const LIST = argv.includes("--list")

/**
 * A REGISTERED SHAPE. Each one names:
 *   id       — what the shape is called
 *   why      — WHY the sites must agree, in one sentence
 *   literal  — the pattern that finds the sites
 *   extract  — how to pull the COMPARED VALUE out of a match (the thing that must be the same)
 *   agree    — the sites must all yield the same extracted value
 *   sites    — the EXACT number of sites the shape must have (null: any number)
 *   onlyIn   — the files the sites are allowed to be in (null: anywhere)
 *   scope    — the DIRECTORIES the shape is read in (default: the fleet's own code)
 */
interface Shape {
  id: string
  why: string
  literal: RegExp
  kind?: "literal" | "ext-array" | "ext-string"
  agree?: boolean
  table?: boolean
  sites?: number | null
  onlyIn?: string[] | null
  scope?: string[] | null
  /** ⇒⇒⇒ WHEN TRUE, ONLY A KEY THAT IS A LANGUAGE IN THE ONE TABLE IS A SITE AT ALL. */
  languageKeysOnly?: boolean
}

/** THE EXTENSION SET OF THE ONE TABLE, NORMALISED — so a copy can be compared with it. */
/** EVERY EXTENSION THE TABLE KNOWS SOMEWHERE — the closed vocabulary a site must draw from to be
 *  counted as an extension-list copy at all. */
const ALL_KNOWN_EXTENSIONS: Set<string> = new Set(
  Object.values(FLEET_LANES).flatMap((v) =>
    String(v)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((e) => (e.startsWith(".") ? e : `.${e}`)),
  ),
)

const tableSet = (lang: string): string[] =>
  // THE PROTOTYPE-CHAIN LOOKUP, REPORTED BY THE GROOVY LANE. The scanner extracts a "language" from a
  // `key: "value"` site, and one of the sites is `constructor: "name"`, so the lookup hit
  // `Object.prototype.constructor` and `.split` was not a function. A TABLE LOOKED UP WITH A KEY THAT
  // CAME FROM THE WORLD MUST NOT RETURN A PROTOTYPE MEMBER INSTEAD OF "NOT IN THE TABLE".
  (Object.hasOwn(FLEET_LANES, lang) ? FLEET_LANES[lang] : "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((e) => (e.startsWith(".") ? e : `.${e}`))
    .sort()

/** THE COMPARED VALUE OF A SITE, BY KIND. */
const valueOf = (shape: Shape, m: RegExpMatchArray): { key: string; value: string } | null => {
  if (shape.kind === "ext-array" || shape.kind === "ext-string") {
    const lang = m[1]
    // THE PROTOTYPE-CHAIN LOOKUP, REPORTED BY THE GROOVY LANE. `lang in FLEET_LANES` is true for
    // "constructor" and "toString", because `in` walks the PROTOTYPE CHAIN — so the filter passed a
    // key that is not in the table at all, and the crash followed. `Object.hasOwn` asks the question
    // the filter means: IS THIS KEY AN ENTRY OF THE TABLE.
    if (shape.languageKeysOnly && !Object.hasOwn(FLEET_LANES, lang)) return null
    const list = m[2]
    const exts = list
      .split(",")
      .map((x) => x.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
      .map((e) => (e.startsWith(".") ? e : `.${e}`))
      .sort()
    // A SITE IS A COPY OF THE TABLE'S ENTRY ONLY IF ITS VALUE IS AN EXTENSION LIST. The shape's
    // premise is "a language's extension LIST is one fact", and a `language: "one-token"` site is
    // not a LIST — it is some other map keyed by a language name, and accusing it of being a wrong
    // copy of the table is a FALSE ACCUSATION IN AN INSTRUMENT THE LANES RUN. The closed-vocabulary
    // test: at least one of the value's tokens must be an extension THE TABLE KNOWS SOMEWHERE.
    if (!exts.some((e) => ALL_KNOWN_EXTENSIONS.has(e))) return null
    return { key: lang, value: exts.join(",") }
  }
  return { key: "", value: m[0] }
}

/**
 * ★⇒⇒⇒ THE SCOPE, AND IT IS A POPULATION RULE. The scanner reads THE FLEET'S OWN CODE — `src/` and
 * `script/m14/` — and NOT the vendored tree-sitter grammar trees, which are lane-owned sources with
 * their own conventions and their own thousands of character classes. ⇒⇒⇒ **A SHAPE IN A VENDORED
 * TREE IS NOT A COPY OF THIS FLEET'S SHAPE**, and a scanner that reads the grammars reports 969
 * sites and says nothing. ⇒⇒⇒ ⇒⇒⇒ AND THE RULE IS THE FLEET'S OWN: **A DIRECTORY WALK AND A
 * TRACKED WALK ARE DIFFERENT POPULATIONS** — here, "the fleet's own code" and "the repository" are
 * different populations, and the shape lives in the first.
 */
const FLEET_CODE = ["src/", "script/m14/"]

const SHAPES: Shape[] = [
  {
    id: "operator-name-class",
    why: "the leaf shape test and `isOperatorName` MUST recognise the same operator names, or one of them silently drops a legal name",
    // ⇒⇒⇒ THE SHAPE IS IDENTIFIED BY ITS CONTENT AND NOT BY ITS SYNTAX. A first attempt matched
    // EVERY character class in the repository — 969 sites, most of them in the vendored
    // tree-sitter grammars — which is not a shape, it is a syntax. ⇒⇒⇒ **A SHAPE THAT MATCHES THE
    // WORLD IS NOT A SHAPE**, so this one matches a class that STARTS WITH `<>=!`, which is what
    // makes it the operator-name class rather than any class at all.
    // ⇒⇒⇒ THE SHAPE IS IDENTIFIED BY ITS CONTENT AND NOT BY ITS SYNTAX. A first attempt matched
    // EVERY character class in the repository — 969 sites, most of them in the vendored
    // tree-sitter grammars — which is not a shape, it is a syntax. ⇒⇒⇒ **A SHAPE THAT MATCHES THE
    // WORLD IS NOT A SHAPE**, so this one matches a bracket expression that STARTS WITH `<>=!`, and
    // the `\\.` alternative inside it is what lets the ESCAPED `\]` be part of the class.
    literal: /\[<>=!(?:\\.|[^\]\\])*\]/g,
    kind: "literal",
    agree: true,
    sites: null,
    onlyIn: null,
  },
  {
    id: "beat-daemon-launch",
    why: "the daemon must be launched in EXACTLY ONE PLACE, or the copy is the one that will be left behind with the relative path",
    // ⇒⇒⇒ THE SHAPE IS THE LAUNCH, NOT THE VERB NAME. The first attempt matched the verb's name
    // and therefore matched the dispatcher's CASE LABEL as well as the launch — a shape that
    // matches a mention is a shape that cannot tell a launch from a reference.
    literal: /setsid[^\n]*__beat-daemon-loop/g,
    kind: "literal",
    agree: false,
    sites: 1,
    onlyIn: ["script/m14/arm-token.sh"],
  },
  {
    id: "hand-written-extension-map",
    why: "the extension table must live in ONE module; a second copy is a second POPULATION under the same name",
    literal: /["']?([A-Za-z][A-Za-z0-9_-]*)["']?\s*:\s*\[((?:"\.[^"]*"\s*,?\s*)+)\]/g,
    kind: "ext-array",
    // ⇒⇒⇒ SAME RULE AS THE STRING SHAPE: ONLY A KEY THAT IS A LANGUAGE IN THE ONE TABLE IS A
    // SITE. Without it the shape matched 180 sites, most of them keyed by an EXTENSION
    // (`import-resolution.ts` maps `js` → what it can resolve) — a different shape entirely.
    languageKeysOnly: true,
    agree: false,
    table: true,
    sites: null,
    onlyIn: null,
  },
  {
    id: "router-extension-literal",
    why: "a language's extension LIST is one fact; a second literal spelling of it is a second fact that can differ",
    literal: /["']?([A-Za-z][A-Za-z0-9_-]*)["']?\s*:\s*"([a-z0-9.+#,-]*)"/g,
    kind: "ext-string",
    // ⇒⇒⇒ THE SHAPE IS ONLY A SHAPE IF ITS KEY IS A LANGUAGE THE TABLE KNOWS. The first attempt
    // matched every `key: "value"` in the fleet's code — 108,597 sites, which is not a shape, it is
    // a language. ⇒⇒⇒ **A SHAPE THAT MATCHES THE WORLD IS NOT A SHAPE.**
    languageKeysOnly: true,
    agree: false,
    table: true,
    sites: null,
    onlyIn: null,
  },
]

/** THE FILES THE SCANNER READS: the TRACKED set, because an untracked file is not part of the
 *  repository and a shape in it is not a shape in the code. */
const tracked: string[] = execFileSync("git", ["ls-files", "-z"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean)
  .filter((f) => /\.(ts|tsx|js|mjs|cjs|sh|json|md)$/.test(f))

interface Site {
  file: string
  line: number
  text: string
  key: string
  value: string
  /** THE WHOLE COMMENT BLOCK THE SITE SITS IN — because a quote that wraps is still a quote. */
  block: string
  /** IS THIS SITE CODE OR A COMMENT? A comment that QUOTES the shape is a MENTION, not a copy of
   *  it — and the Lead's own defect was exactly a comment that quoted the shape WRONGLY, so a
   *  comment is not noise either. It is a THIRD KIND OF THING, checked against the code. */
  comment: boolean
}

/**
 * ⇒⇒⇒ THE WHOLE COMMENT BLOCK, FOR EVERY LINE OF IT. A quote that WRAPS IS STILL A QUOTE, and the
 * scanner's first version read ONE LINE — so a comment that said "the class is `/^[<>=!…]+$/`, AND
 * IT DOES NOT" and wrapped the "DOES NOT" onto the next line looked like a comment that CLAIMED the
 * old value, when it was a comment that EXPLAINS the old value. ⇒⇒⇒ ⇒⇒⇒ **THE INSTRUMENT CAUGHT
 * ITS OWN FALSE POSITIVE ON ITS OWN OUTPUT, AND THE FIX IS THE SAME RULE AS EVER: READ THE WHOLE
 * THING, NOT A PIECE OF IT.** ⇒⇒⇒ ⇒⇒⇒ Two lane-owned comments were being reported as STALE when
 * both were CORRECT, and a false accusation in an instrument the lanes run is a false accusation.
 */
const commentBlockOf = (lines: string[]): Map<number, string> => {
  const map = new Map<number, string>()
  let i = 0
  while (i < lines.length) {
    if (!isCommentLine(lines[i])) {
      i++
      continue
    }
    const start = i
    while (i < lines.length && isCommentLine(lines[i])) i++
    const block = lines
      .slice(start, i)
      .map((l) => l.trim().replace(/^(\/\/|\*|#|\/\*)\s?/, ""))
      .join(" ")
    for (let j = start; j < i; j++) map.set(j + 1, block)
  }
  return map
}

/** ⇒⇒⇒ A LINE IS A COMMENT IF IT IS ONLY A COMMENT. The test is DELIBERATELY SHALLOW — a line can
 *  be code AND carry a trailing comment, and the shape inside a trailing comment is still a
 *  mention. ⇒⇒⇒ **A LINE THAT IS ONLY A COMMENT IS NOT A SITE.** */
const isCommentLine = (line: string): boolean => {
  const t = line.trim()
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("#") || t.startsWith("/*")
}

/**
 * ⇒⇒⇒ THE MARKERS OF A COMMENT THAT IS *DELIBERATELY* QUOTING A PREVIOUS VALUE. A comment that
 * says "the class WAS `/^[<>=!+\-*\/%^&|~]+$/`" is DOCUMENTING THE FIX and is not a defect; a
 * comment that says "the class IS `/^[<>=!+\-*\/%^&|~]+$/`" when the code says otherwise is THE
 * LEAD'S OWN DEFECT — right about the language, wrong about the code. ⇒⇒⇒ **A COMMENT QUOTING THE
 * SHAPE MUST AGREE WITH THE CODE OR MUST SAY THAT IT IS QUOTING THE PREVIOUS VALUE.**
 */
const PAST_MARKERS = [
  "WAS", "was ", "DOES NOT INCLUDE", "does not include", "OLD", "old ", "PRE-FIX", "pre-fix",
  "BEFORE", "before ", "FORMER", "former ", "PREVIOUS", "previous ", "already exempt",
  "NO LONGER", "no longer", "INCOMPLETE", "incomplete", "DOES NOT", "does not", "NOT INCLUDE",
  "not include", "NEVER MATCHED", "never matched", "REFUSED BEFORE", "refused before",
]

const sitesFor = (shape: Shape): Site[] => {
  const out: Site[] = []
  const scope = shape.scope ?? FLEET_CODE
  for (const file of tracked) {
    if (!scope.some((p) => file.startsWith(p))) continue
    let text: string
    try {
      text = readFileSync(resolve(ROOT, file), "utf8")
    } catch {
      continue
    }
    const lines = text.split("\n")
    const blocks = commentBlockOf(lines)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // ⇒⇒⇒ A GLOBAL regex CARRIES `lastIndex` BETWEEN CALLS, so the pattern is REBUILT per line
      // and the loop is a `while` — otherwise a line with two sites finds only the first, and a
      // shape that finds only the first of two is a shape that cannot count.
      const re = new RegExp(shape.literal.source, shape.literal.flags)
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        const v = valueOf(shape, m)
        if (v) {
          out.push({
            file,
            line: i + 1,
            text: line.trim().slice(0, 170),
            key: v.key,
            value: v.value,
            comment: isCommentLine(line),
            block: blocks.get(i + 1) ?? line,
          })
        }
        if (m.index === re.lastIndex) re.lastIndex++
      }
    }
  }
  return out
}

if (LIST) {
  console.log("REGISTERED SHAPES:")
  for (const s of SHAPES) console.log(`  ${s.id} — ${s.why}`)
  process.exit(0)
}

const problems: string[] = []
console.log("THE SHAPE-AGREEMENT SCANNER — every site of every registered shape, and whether the sites AGREE\n")

for (const shape of SHAPES) {
  if (ONLY && shape.id !== ONLY) continue
  const sites = sitesFor(shape)
  const codeSites = sites.filter((s) => !s.comment)
  const commentSites = sites.filter((s) => s.comment)
  const values = new Map<string, Site[]>()
  for (const s of codeSites) {
    const k = s.key ? `${s.key} => ${s.value}` : s.value
    const arr = values.get(k) ?? []
    arr.push(s)
    values.set(k, arr)
  }
  const distinct = [...values.keys()].sort()

  console.log(`── ${shape.id} — ${sites.length} site(s) (${codeSites.length} code, ${commentSites.length} comment)`)
  console.log(`   why: ${shape.why}`)
  for (const s of sites) {
    const bad = shape.onlyIn && !shape.onlyIn.includes(s.file)
    const mark = s.comment ? " (comment)" : "          "
    console.log(`   ${bad ? "!!" : "  "}${mark} ${s.file}:${s.line}  ${s.key ? `${s.key} => ` : ""}${JSON.stringify(s.value)}`)
  }

  if (shape.agree && distinct.length > 1) {
    const msg = `${shape.id}: the CODE sites DISAGREE — ${distinct.length} distinct values: ${distinct.map((v) => JSON.stringify(v)).join(", ")}`
    console.log(`   ⇒⇒⇒ ${msg}`)
    problems.push(msg)
  } else if (shape.agree && distinct.length === 1 && codeSites.length > 0) {
    console.log(`   ⇒⇒⇒ the CODE sites AGREE: ${JSON.stringify(distinct[0])}`)
  }

  // ⇒⇒⇒ THE COMMENTS ARE CHECKED AGAINST THE CODE, NOT IGNORED. A comment that quotes the shape
  // WRONGLY is THE LEAD'S OWN DEFECT — the comment in `pool-worker.ts` said the class was
  // `/^[<>=!+\-*\/%^&|~]+$/` while the code said something else, and the comment was RIGHT ABOUT
  // THE LANGUAGE AND WRONG ABOUT THE CODE. ⇒⇒⇒ **A COMMENT QUOTING THE SHAPE MUST AGREE WITH THE
  // CODE OR MUST SAY THAT IT IS QUOTING THE PREVIOUS VALUE.**
  if (shape.agree && codeSites.length > 0 && distinct.length === 1) {
    const codeValue = distinct[0]
    for (const c of commentSites) {
      const ck = c.key ? `${c.key} => ${c.value}` : c.value
      if (ck === codeValue) continue
      const past = PAST_MARKERS.some((mk) => c.block.includes(mk))
      if (past) {
        console.log(`   ⇒⇒⇒ ${c.file}:${c.line} quotes the PREVIOUS value (and says so) — ${JSON.stringify(ck)}`)
        continue
      }
      const msg = `${shape.id}: the comment at ${c.file}:${c.line} quotes ${JSON.stringify(ck)} but the code says ${JSON.stringify(codeValue)}, and the comment does not say it is quoting a previous value`
      console.log(`   ⇒⇒⇒ ${msg}`)
      problems.push(msg)
    }
  }

  if (shape.table) {
    // ⇒⇒⇒ THE COPIES MUST AGREE WITH THE ONE TABLE, NOT JUST WITH EACH OTHER. A copy that says
    // `cpp: [".cpp", ".cc", ".h"]` beside a table that says nine extensions is a DIFFERENT
    // POPULATION wearing the same name, and agreeing with itself would not catch it.
    const seen = new Set<string>()
    for (const s of sites) {
      if (!s.key) continue
      const canonical = tableSet(s.key)
      if (canonical.length === 0) continue
      if (seen.has(s.key)) continue
      seen.add(s.key)
      const mine = s.value.split(",").sort()
      if (mine.join(",") === canonical.join(",")) continue
      // THE SCANNER CANNOT DISTINGUISH "A COPY OF THE TABLE'S ENTRY" FROM "A PER-LANGUAGE
      // REPRESENTATIVE EXTENSION", AND THAT IS A LIMIT OF THE SHAPE, NOT A DEFECT IN THE ROUTER.
      // The router's own dispatch tables name ONE extension per language (a `.svelte` for svelte),
      // and a copy of the table's ENTRY would name all of them. So:
      //   - a site whose tokens are DISJOINT from the table's entry is not a copy of it at all;
      //   - a site with ONE token that the table also names is a PARTIAL SPELLING — a different kind
      //     of thing from a disagreement, and it is reported as one and is not a problem.
      // A FALSE ACCUSATION IN AN INSTRUMENT THE LANES RUN IS A FALSE ACCUSATION.
      const overlap = mine.filter((e) => canonical.includes(e))
      if (overlap.length === 0) {
        console.log(`   ⇒⇒⇒ ${shape.id}: ${s.file}:${s.line} names ${s.key} => [${mine.join(", ")}], which shares NO extension with the table's entry [${canonical.join(", ")}] — it is not a copy of the entry, so it is not a disagreement`)
        continue
      }
      if (mine.length === 1) {
        console.log(`   ⇒⇒⇒ ${shape.id}: ${s.file}:${s.line} is a PARTIAL SPELLING of ${s.key}'s entry — it names [${mine.join(", ")}] where the table names [${canonical.join(", ")}] — a per-language representative extension, not a copy of the entry`)
        continue
      }
      const msg = `${shape.id}: the copy of ${s.key}'s extensions DISAGREES WITH THE ONE TABLE — copy has [${mine.join(", ")}], the table has [${canonical.join(", ")}]`
      console.log(`   ⇒⇒⇒ ${msg}`)
      problems.push(msg)
    }
  }

  if (shape.sites !== null && shape.sites !== undefined && sites.length !== shape.sites) {
    const msg = `${shape.id}: expected EXACTLY ${shape.sites} site(s) and found ${sites.length}`
    console.log(`   ⇒⇒⇒ ${msg}`)
    problems.push(msg)
  }

  if (shape.onlyIn) {
    for (const s of sites) {
      if (!shape.onlyIn.includes(s.file)) {
        const msg = `${shape.id}: a site is in ${s.file}, which is not allowed to hold this shape (allowed: ${shape.onlyIn.join(", ")})`
        console.log(`   ⇒⇒⇒ ${msg}`)
        problems.push(msg)
      }
    }
  }
  console.log("")
}

if (problems.length > 0) {
  console.error(`THE SHAPE-AGREEMENT SCANNER FOUND ${problems.length} PROBLEM(S):`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error("")
  console.error("⇒⇒⇒ A SHAPE COPIED IN TWO PLACES IS ONE SHAPE THAT WILL BE FIXED IN ONE PLACE ONLY.")
  console.error("⇒⇒⇒ And a shape whose sites DISAGREE is a shape that is already broken somewhere.")
  process.exit(5)
}

console.log("every registered shape agrees, and every expected site count holds.")
process.exit(0)
