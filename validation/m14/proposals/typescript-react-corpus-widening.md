# PROPOSAL — widen / re-scope the React (TSX) side of the typescript lane

**From:** typescript lane owner · **Date:** 2026-10-17 · **Status:** for the Lead
**Measured with:** `validation/m14/fixtures/typescript/tools/react-census.mts`
(`TYPESCRIPT-REACT-CENSUS.txt`) and `script/m14/incoming-gate.ts tsx tsx 400`
(`TYPESCRIPT-TSX-GATE-R2.txt`)

## 1 · The premise I was given, checked

> "The corpus holds 2,932 .tsx files but only ONE react-named repo."

Both halves are **wrong as stated**, and the correction matters for what to do next:

* `.tsx` files: **3,377 on disk** and **3,377 tracked** — exactly the gate's own `git ls-files`
  population for the `tsx` language. The 2,932 figure is a `find` that does not follow the
  **symlink** `fixtures/repositories/proxicall -> ~/ProxiCall`, which alone carries **445** `.tsx`
  files. (2,932 + 445 = 3,377.)
* Repos named `react`: **ZERO** of the 199 corpus repos. The 17 repos carrying `.tsx` are
  hasura-engine (1,367), gql-graphql-platform (575), redwood (480 tracked / 463 admitted),
  proxicall (445), traefik (144), element-plus (141 — Vue TSX, 0 react imports), riverpod (66),
  wagtail (65) and 9 smaller ones.

## 2 · Is it real React? Counts, not prose

Textual layer over every `.tsx` (labelled textual in the artifact):

| signal | count | share |
|---|---|---|
| JSX-shaped tag | 3,165 | 93.7% |
| imports `react` / `react-dom` | 1,811 | 53.6% |
| `className=` | 1,804 | 53.4% |
| `props.` / `Props` | 1,580 | 46.8% |
| calls a React hook | 618 | 18.3% |
| `useState(` / `useEffect(` | 303 / 333 | 9.0% / 9.9% |

Analyzer layer, 374-file stride through the production entry (`parseFile`, tsx grammar):
**374/374 parsed, 0 failures**, 2,662 symbols, 16,019 relationships, **1,782 `uses` edges carrying
`jsxElement` over 284 files**, **613 distinct JSX component targets**, **508 hook calls over 130
files** (useState 132 · useEffect 60 · useRef 31 · useMemo 20 · useCallback 25 …). 9 of the 10
relationship types fire on the stride (`implements` is 0 in it).

**Conclusion: the React corpus is REAL and NOT thin in files.** It is thin in DIVERSITY (4 repos =
84.4% of the TSX) and it is INVISIBLE to the lane's headline gate.

## 3 · Two asks (in priority order)

### Ask 1 — put `tsx` in the lane's measured population (shared script; Lead owns it)

The lane's mandated gate command is
`bun run script/m14/incoming-gate.ts typescript ts 400`. `.tsx` routes to the language id `tsx`
(`language-detection.ts:39`, `engine.ts:947/2263`) and is therefore **excluded from every number the
lane reports**. The gate already accepts a comma list (`ext.split(",")`, `discoverFiles`), so this is
a one-token change to the invocation, not to the instrument:

```
bun run script/m14/incoming-gate.ts typescript ts,tsx 400
```

I ran it once to prove it works and to give the Lead the population size:
**17,207 .ts/.tsx files across 41 repos** (13,830 .ts + 3,377 .tsx), 400 sampled, parse failures 0,
**22,948 edges · resolved 6,726 · amb 921 · unresolved 10,151 · extOK 5,150 · extFAIL 0**
(`TYPESCRIPT-GATE-TS-TSX-R2.txt`). Without this, any claim that the lane covers React is a claim
about an UNMEASURED population — exactly what the owner's brief forbids.

### Ask 2 — add ONE canonical React application/library checkout (optional, diversity only)

Not a thinness fix — a concentration fix. The top 4 repos hold 84% of the `.tsx` and only one of them
(`redwood`) is a React framework. Adding a canonical React codebase (e.g. `facebook/react`,
`vercel/next.js`, `remix-run/remix`) would exercise:
* class components and legacy lifecycle methods (the current corpus is hooks-heavy modern code),
* `React.forwardRef` / `memo` / context providers at scale,
* `.tsx` barrels and `export default function Page()` routing (redwood/next shapes),
* React's own `ReactDOM` call sites — which are the `className`/props/JSX-heavy files a React
  analyzer should be judged on.

If the Lead prefers not to widen, the honest alternative is to **record the boundary in the spec**:
"React coverage = 3,377 tracked .tsx, measured by a separate tsx gate; the headline lane number is
.ts-only." I have already written that boundary into
`validation/m14/verification/TYPESCRIPT-STATE.md` §6 and
`docs/analyzers/real-typescript-analyzer.md`.

## 4 · What this proposal does NOT claim

* No claim that every React construct is covered. Measured: JSX element uses, hook `calls`, and the
  JSX component `uses` surface; **NOT** measured this iteration: props-type edges, `className`
  as an edge, `React.memo`/`forwardRef` wrappers, class-component lifecycle `overrides`.
* No claim that the tsx gate's residual is a React defect. Its 10,151 unresolved are the same
  causes the .ts census names (relative imports, chain receivers, bare packages) — the tsx gate
  output is attached so a reader can bucket it rather than guess.
