/**
 * THE ROUTER'S EXTENSION TABLE — ONE TABLE, AND THE ONLY ONE.
 *
 * ★ WHY THIS FILE EXISTS. The heritage blind-spot probe carried its OWN hand-written extension
 * map, and the cpp lane MEASURED that the probe's map had no `cpp` entry — so `EXT[LANG] ?? []`
 * was EMPTY, every tracked file was filtered out before the walk, and the probe printed
 * "population: 0 GIT-TRACKED admitted files", "files read 0", "heritage clauses 0", "UNCOVERED 0"
 * and "no base_class_clause clause was found in the population", EXIT 0.
 *
 * ⇒⇒⇒ **THAT IS A CLEAN-LOOKING ZERO OVER AN EMPTY POPULATION**, and it is the fleet's most
 * dangerous shape: a measurement that cannot call the thing it measures, taken over nothing, and
 * reported with the same confidence as a measurement over everything. The cpp lane answered the
 * substantive question with its OWN instrument over the whole admitted population — 4,279
 * `base_class_clause` clauses, UNCOVERED 0 — and the probe's zero was beside it and said nothing.
 *
 * ⇒⇒⇒ AND THE FIX IS NOT "ADD CPP TO THE PROBE'S MAP". That only moves the failure to the next
 * language. The fix is that THE INSTRUMENT AND THE DENOMINATOR MUST COUNT THE SAME POPULATION, so
 * there is ONE table and every consumer reads it.
 *
 * ⇒⇒⇒ AND THE TABLE IS EXTRACTED, NOT COPIED, because `incoming-gate.ts` RUNS ITS WHOLE BODY ON
 * IMPORT — so importing the table from there would run the fleet's entire gate as a side effect of
 * importing a constant. The maps moved HERE, `incoming-gate.ts` re-exports them, and every consumer
 * reads this file. ⇒⇒⇒ **A TABLE DUPLICATED IN TWO PLACES IS ONE TABLE THAT WILL DIVERGE**, and it
 * did: the gate's population and the probe's population were different populations under the same
 * name, which is the same defect as the index cache keyed on a COUNT.
 *
 * ⇒⇒⇒ THE MAPS THEMSELVES ARE UNCHANGED — this is a MOVE, not an edit. The comments that explain
 * WHY each extension is admitted travel with them, because those comments are the lane's only
 * record of a decision that looks arbitrary until it is explained.
 */

/** Laptop B's 23 lanes — asserted, not inferred, and this literal is the authority. It cited
 *  `docs/analyzers/PROMPT-LAPTOP-B.md:15` until 2026-10-28, when that stale assignment document was
 *  deleted; the lane set below was already the source of truth, so nothing operational moved. */
export const LANES_B: Record<string, string> = {
  bash: "sh,bash,zsh", fsharp: "fs,fsi,fsx", zig: "zig", lua: "lua", julia: "jl", nim: "nim,nims,nimble",
  // RUBY AND SOLIDITY ADDED 2026-10-20 (Lead). The engine has an analyzer for both and BOTH HOLD
  // AN ACCEPTED D1-D6 VERDICT (ruby §20, solidity §19), yet NEITHER WAS IN EITHER MAP — so the
  // fleet sweep never measured them, and the population gate could not see them either (it only
  // compared the lanes an instrument DECLARES). The extension lists are read from the router.
  ruby: "rb", solidity: "sol",
  // PHP ADMISSES `phpt` — the router maps it to php and the ENGINE reads it with the php
  // analyzer, so the lane was measuring 5,114 files while production's php surface is 6,424
  // (1,310 `.phpt` files, 1 repo, measured). The population gate named it as MISSING.
  php: "php,phpt", powershell: "ps1,psm1,psd1", r: "r", dart: "dart", sql: "sql", graphql: "graphql,gql,graphqls",
  // `.graphqls` ADDED. The lane definition carried `graphql` and `gql`, and the ROUTER carried the same two —
  // so `.graphqls` was invisible to BOTH, which is why fixing one place would not have moved the gate's own
  // population. MEASURED: 97 corpus `.graphqls` files, worth 83,371 SYMBOLS and 195,108 RELATIONSHIPS, read by
  // nothing. The router fix is `1150b2140`; this is the lane definition beside it, and the two must agree or a
  // lane's population and the engine's population are different sets.
  // NOTE: no `key: "value"` shape and no backticks in this comment — the parser below reads this literal
  // quote-aware but NOT comment-aware.

  protobuf: "proto", json: "json,jsonc,jsonl,jsonlog",
  // `.jsonlog` ADDED, at BOTH sites in one commit — the fourth time today these two lists had to be kept
  // together (graphqls, sass, jsonl, and now this), so both are named here on purpose.
  // NOTE: no shape of key-colon-quote in this comment and no backticks — the parser reads this literal
  // quote-aware but NOT comment-aware.

  // `.jsonl` ADDED, and it is a SEPARATE list from the router — the two were half-kept three times today
  // (graphqls, sass, and now this), so both sites are named in the same commit on purpose.
  // NOTE: no shape of key-colon-quote in this comment and no backticks: the parser reads this literal
  // quote-aware but NOT comment-aware, and a comment carrying one is read as a lane.

  // BOTH SPELLINGS, because one language does not become a different population by being spelled
  // `.yml`. Measured on ansible — 13 `.yaml` files against 2,068 `.yml`, 2,081 combined — so the
  // `--all` table was measuring 0.6% of the lane's files and reporting the 13-file verdict as the
  // lane's. `firing-check.mjs` has always admitted both spellings, which is exactly how the two
  // instruments came to disagree (HANDOFF §5.2).
  //
  // READ THIS BEFORE WRITING A COMMENT IN THIS LITERAL. `language-board.ts` parses LANES_B by
  // splitting the object body on top-level commas and taking `key` before the first colon and
  // `value` after it — quote-aware, but NOT comment-aware. A comment whose text contains a
  // COLON-SPACE-QUOTE sequence is therefore read as a lane. The first version of this comment
  // contained one and the board reported 26 lanes, three of them sentences. Comments here stay
  // free of `key: "value"` shapes and of backticks.
  yaml: "yaml,yml",
  // CSS AND SCSS, AND THE `sass` EXTENSION, MOVED (2026-10-20, Lead). The router gives `.sass` to
  // its OWN language, and the ENGINE reads it with the CSS analyzer and the CSS grammar — the
  // router's own comment records that the indented syntax parses there with ERROR nodes. So the
  // scss lane must NOT admit `sass` (it was measuring 67 files production never gives that
  // analyzer) and the css lane MUST (production reads all 67). The population gate names both
  // halves of this move; the css baseline of 1,175 files becomes 1,242 and the scss baseline of
  // 4,433 becomes 4,366, so BOTH are VOID-PENDING-RERUN until the lanes re-measure.
  css: "css,less,sass", scss: "scss",
  // `.sass` ADDED. The ROUTER already maps it — to its own language, which `language-detection.ts` records as a
  // fix in its own right — and NO LANE ADMITTED IT, so 67 corpus files were routed to a language nothing
  // measured. Third instance of this shape in one day: the router and the lane definition are separate lists and
  // only one of them was being kept; `.graphqls` was the first, and `.sass` is the same defect one file over.
  // MEASURED: 67 admitted `.sass` files, ALL of them routed to `sass` (Documenter.jl 64, bulma 3).
  // NOTE: no `key: "value"` shape and no backticks in this comment — the parser reads this literal quote-aware
  // but NOT comment-aware, and a comment containing one is read as a lane.

  // `make: "mk,mak,makefile"` NOW ADMITS A BARE `Makefile`. It did not, because `admitByExtension`
  // matched a trailing dot-plus-ext and that file has no extension to match — and the note that stood
  // here REPORTED the gap for months instead of fixing it, which made the gate's population 129 files
  // where the production router admits 697 (18.5%). Found by make-lane, which measured the router's
  // own predicate and found it disagreed with this table. The predicate now also matches a bare
  // basename equal to an admitted ext; see its docstring.
  //
  // GNUmakefile IS A MAKE BASENAME TOO, and the router says so itself:
  // `BASENAME_LANGUAGE` maps both `makefile` and `gnumakefile` to `make`
  // (src/ast/language-detection.ts). This table carried only `makefile`, so the admission's
  // `base === e` clause could never match `GNUmakefile` and the instrument under-admitted the
  // lane by exactly 14 corpus files (enumerated by the make lane with a two-walk diff:
  // router-admits 807, gate-admitted 793 — 14 in router not gate, 0 the other way). The fix is
  // the spelling, not the predicate: the basename clause is faithful already, it just had a
  // table entry missing. MEASURED 2026-10-27 (make-lane pop-diff).
  // XML IS SEVEN SPELLINGS, and the router says so itself: `src/ast/language-detection.ts` maps
  // `.xml .xsd .dtd .svg .xsl .xslt .rng` all to the `xml` language. This table admitted only the
  // first, so every xml number from this instrument covered **2,081 of the lane's 11,552 files
  // (18.0%)** — and only **3.0% of its `references`** edges and 29.1% of its `imports`. Measured by
  // xml-lane, which also noted that this table already records the identical defect and fix for
  // yaml one line above ("one language does not become a different population by being spelled
  // .yml"). The same sentence applies with six more spellings.
  hcl: "tf,hcl,tfvars,tofu", make: "mk,mak,makefile,gnumakefile", toml: "toml", xml: "xml,xsd,dtd,svg,xsl,xslt,rng", markdown: "md,markdown", clean: "icl,dcl",
}

/**
 * LAPTOP-A LANES — the other 23 analyzers, added 2026-10-12.
 *
 * THE EXTENSION LISTS ARE VERIFIED AGAINST THE ROUTER, NOT WRITTEN FROM MEMORY: every extension below was run
 * through `detectLanguageFromPath` and all 23 lanes report ZERO unrouted extensions. That check exists because
 * THREE router gaps were found in one day (.cts, .graphqls, .sbt/.phpt) and each one was an extension nobody had
 * noticed was missing from a list like this one.
 *
 * TWELVE OF THESE TWENTY-THREE ARE MEASURED as of 2026-10-12, on 400-file strides, and every one is tough:
 * javascript 84.5, rust 78.5, java 77.4, python 76.9, typescript 73.4, csharp 65.7, go 64.4, swift 44.6,
 * scala 38.6, kotlin 23.9, php 23.2 and cpp/c/perl/groovy assigned. THE RATES IN THAT SENTENCE ARE NOT ALL THE
 * SAME FRACTION — the first seven come from the gate's own columns and the rest from a resolved-per-edge read —
 * so quote edges, resolved, amb and unresolved and let the reader form the rate.
 *
 * NOTE FOR ANYONE EDITING THIS FILE: the parser rule stated above LANES_B applies here too. This literal is read
 * quote-aware but NOT comment-aware, so a comment must not contain a key-colon-quote shape and must not contain
 * a backtick.
 */
export const LANES_A: Record<string, string> = {
  // `cpp` NOW ADMITS `h`. The engine has sniffed `.h` CONTENT since language-detection.ts:402 (class /
  // namespace / template< / :: decide cpp), so production already routes ~3,095 of the 15,098 measurable
  // `.h` files to cpp and the rest to c. THIS TABLE DID NOT, so cpp's population was missing its own
  // headers: measured on 2026-10-17, 83% of cpp's `calls` residual was declared in a `.h` file the lane
  // never parsed, and the lane measured 56% of the files the router assigns it. The fix is the admission
  // ONLY — the per-file routing still runs through the engine, so no file is measured twice and C keeps
  // the plain-C headers it is entitled to. Found by c's lane (proposals/c-h-boundary.md), which measured
  // 2,936 genuine C++ headers inside C's 15,098 (19.45%) and priced extension-only routing as a
  // 12,162-plain-C-header regression.
  // CPP ADMISSES THE FOUR EXTENSIONS THE ROUTER GIVES IT AND THIS MAP DID NOT (2026-10-20, Lead):
  // `c++`, `ipp`, `inl`, `cu` — 20 corpus files, of which `c++` is 0, so the population change is
  // SMALL; but the lane's own ACCEPTED VERDICT ARM (§14.1) was measured on the FULL set
  // (cpp,cc,cxx,c++,hpp,hxx,ipp,inl,cu), so this map was NARROWER THAN THE VERDICT THAT EXISTS
  // and the fleet sweep could not reproduce the lane's own number. `hh` stays (the engine
  // content-sniffs it) and `h` stays (see the note above it).
  c: "c,h", clojure: "clj,cljs,cljc,edn", cpp: "cpp,cc,cxx,c++,hpp,hxx,hh,h,ipp,inl,cu", csharp: "cs,csx",
  elixir: "ex,exs", erlang: "erl,hrl", go: "go", groovy: "groovy,gvy,gradle", haskell: "hs,lhs",
  // HTML ADMISSES THE ELEVEN TEMPLATE EXTENSIONS THE ROUTER GIVES IT (2026-10-20, Lead): the
  // router maps xhtml, hbs, twig, pug, erb, mustache, ejs, liquid, njk, jinja and j2 to html, and
  // the ENGINE reads every one of them with the html analyzer (the router's own comment: routing
  // them cannot lose a row, only add). MEASURED: 2,099 corpus files (hbs 1,531 · twig 274 · j2 139
  // · pug 70 · erb 49 · xhtml 30 · jinja 3 · liquid 3), so the html lane was measuring 6,789 files
  // while production's html surface is 8,888 — a 31% shortfall. The html baseline is
  // VOID-PENDING-RERUN until the lane re-measures.
  html: "html,htm,xhtml,hbs,twig,pug,erb,mustache,ejs,liquid,njk,jinja,j2", java: "java", javascript: "js,mjs,cjs,jsx", kotlin: "kt,kts",
  // PERL ADMISSES `perl` (the router maps it to perl; 0 corpus files, so the population is
  // unchanged and the correction is free — but the list said one thing and the router another).
  // VBA AND MATLAB ARE LANES WITH ANALYZERS, SPECS AND FIXTURES BUT NO ENTRY IN EITHER MAP (2026-10-31,
  // Lead). The coverage gate enumerates `src/ast/real-*-analyzer.ts`, so both lanes were READ and
  // reported (`impl 0/0`, "no spec") while the population gate and every sweep could not measure them:
  // an instrument that cannot see a lane cannot arm it, and a lane with no arm cannot carry a
  // declaration. The extension lists are the ROUTER'S: `vba`/`bas`/`cls`/`frm` map to vba
  // (language-detection.ts), and matlab is the content-disambiguated half of `.m` (see the note on
  // admitByExtension in incoming-gate.ts — matlab is NOT admitted by extension alone).
  vba: "vba,bas,cls,frm",
  matlab: "m",
  "objective-c": "m,mm", perl: "pl,pm,t,pod,perl", python: "py,pyi,pyw", rust: "rs",
  scala: "scala,sc,sbt", svelte: "svelte", swift: "swift",
  typescript: "ts,tsx,mts,cts", vb: "vb", vue: "vue",
}

/**
 * THE FLEET'S LANE SET — THE UNION OF THE TWO MAPS ABOVE.
 *
 * The two maps exist because the programme began on two machines ("laptop A" and "laptop B"), and
 * every sweep path iterated `LANES_B` ONLY. So the 23 lanes in `LANES_A` — java, typescript,
 * javascript, python, cpp, c, dart, go, groovy, haskell, html, kotlin, scala, clojure, csharp,
 * elixir, erlang, rust, svelte, swift, vb, vue, objective-c, perl — were MEASURABLE BY NAME but
 * never swept, and the population gate could not see them either (it compared only the lanes an
 * instrument declared, and the instrument declared one map).
 *
 * `FLEET_LANES` is the union, and every sweep path now iterates it, so the fleet sweep covers
 * every lane the engine has an analyzer for. `LANES_A` and `LANES_B` stay as the two named maps
 * they have always been — the union is derived, never hand-maintained a third time.
 */
export const FLEET_LANES: Record<string, string> = { ...LANES_A, ...LANES_B }

/**
 * THE EXTENSIONS FOR ONE LANE, AS A LIST, DERIVED FROM THE TABLE ABOVE — so no consumer keeps a
 * second copy of the population.
 */
export function extensionsFor(language: string): string[] {
  const raw = FLEET_LANES[language]
  if (!raw) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((e) => (e.startsWith(".") ? e : `.${e}`))
}
