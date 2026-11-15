# Backbencher Website

The Next.js website for [backbencher.cc](https://backbencher.cc), living inside
the backbencher-brain monorepo so site claims can be verified side-by-side with
the product's pinned artifacts (M41).

## Commands

Run from `website/`:

```bash
npm install
npm run dev        # local dev server
npm run typecheck  # tsc --noEmit (site tsconfig)
npm run build      # production build
```

## Truth pipeline (M41)

Site numbers (version, tool list, parameters, tables, languages, CLI commands)
come from `src/data/truth.generated.ts`, which is **auto-generated** by
`script/m41/generate-site-truth.ts` from the artifacts the closure gates pin.
Never hand-edit the generated file; regenerate instead:

```bash
# from the repo root
npx tsx script/m41/generate-site-truth.ts          # regenerate
npx tsx script/m41/generate-site-truth.ts --check  # verify no drift (CI gate)
```

`script/m41/verify-site-truth.ts` builds the site and checks rendered output
against the artifacts; `npm run verify` at the repo root runs the full chain.
Hand-typed claims on pages are a CI failure.

## Deploy

Vercel (git integration). Deploy gating is contractual: CI must be green; the
wait-for-checks wiring is proven by M41.X1.
