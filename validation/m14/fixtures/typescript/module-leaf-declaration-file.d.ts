// The MODULE NAME a `.d.ts` file publishes. VERIFY_TS10.
//
// `imports` and `exports` edges are sourced from the module, and the module of a
// TypeScript declaration file is its STEM: the module `env.d.ts` declares is
// `env`, which is what every consumer that joins these edges looks for.
//
// `moduleLeafName()` was `path.basename(file, path.extname(file))`, and
// `path.extname("env.d.ts")` is `.ts`, so the leaf came out `env.d`. Measured by
// script/m14/ts-production-drop.mjs on element-plus: 368 `imports` + `exports`
// edges across 3 `.d.ts` files were sourced from `env.d` / `components.d` /
// `index.d`, and a run of the lane's own imports/exports oracle against the same
// corpus disagreed with the analyzer on 365 of them for that reason alone.
//
// This fixture pins the leaf by NAME on both channels, so the fix cannot be
// "delete the suffix" applied somewhere it does not belong: its control is
// `module-leaf-dotfile-stem` (`leaf.module.config.ts`, whose leaf must keep
// `.config`), and the mutant below re-breaks exactly this line.
//
// Authored from a re-probed emission: the edges below are the analyzer's, and the
// only assertion under test is the SOURCE half of them.
import { helper } from "./helper";
import { Config } from "./config";

export declare function build(): Config;
export { helper };
export * from "./reexport";