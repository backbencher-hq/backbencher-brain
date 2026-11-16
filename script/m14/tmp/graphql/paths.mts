/**
 * Where this lane's probes live and what they read.
 *
 * These probes used to hardcode two absolute paths, which is fine exactly once
 * and then never again: the lane's own directory was outside the repository, so
 * a clone had no `run-all.sh`, no ground truth and no artifacts, and every claim
 * in `docs/analyzers/graphql.md` was unverifiable from a checkout.
 * The hcl lane's commit message states the rule this module exists to satisfy —
 * "a probe lives in a TRACKED location so the next reader can re-run it".
 *
 * So the lane directory is derived from THIS file's own location, and the
 * repository root is derived from that. `BB_ROOT` overrides the root for a probe
 * run against a different checkout, which is the only reason it is configurable:
 * a second clone on the same machine must work without editing twenty files.
 */
import * as path from "path"
import { fileURLToPath } from "url"

/** This lane's directory: `script/m14/tmp/graphql`. */
export const GQL = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

/** Alias, because the probes that predate this module called it `HERE`. */
export const HERE = GQL

/** The repository root: `<repo>/script/m14/tmp/graphql` walked up four levels. */
export const ROOT = process.env.BB_ROOT
  ? path.resolve(process.env.BB_ROOT)
  : path.resolve(GQL, "..", "..", "..", "..")

/** Generated artifacts. Tracked, because the docs cite them by path. */
export const OUT = path.join(GQL, "out")

/** The hand-derived differential truth, which is the input, not an output. */
export const GROUND_TRUTH = path.join(GQL, "fixtures", "ground-truth.json")

/**
 * The third-party corpora. Deliberately NOT tracked — 1.2 GB of cloned
 * graphql-js / graphiql / neo4j checkouts — so they are the one input a reader
 * must fetch. Every probe that reads them records the exact revision it used, so
 * a missing corpus is a fetch instruction rather than a mystery.
 */
export const CORPORA = process.env.GQL_CORPORA ?? "<corpus-root>/bb_tests/graphql/repos"

/** The wired grammar under test. */
export const WASM = process.env.GQL_WASM ?? path.join(ROOT, "wasm/tree-sitter-graphql.wasm")

/** The grammar the wired one REPLACED, kept byte-for-byte so the A/B is reproducible. */
export const PREVIOUS_WASM = path.join(GQL, "grammar-rebuild", "tree-sitter-graphql-VENDORED-BEFORE.wasm")
