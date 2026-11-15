// The CONTROL for module-leaf-declaration-file.d. VERIFY_TS10.
//
// Leaf identity is `basename` minus the LAST extension, and it must stay that
// way: `dotfile-stem.module.config.ts` publishes the module
// `dotfile-stem.module.config`. Only a DECLARATION file's `.d` is part of the
// extension rather than part of the name.
//
// The name is the assertion. A first attempt at this control was called
// `module-leaf-dotfile-stem.ts`, whose only dots are the extension's — so a
// mutant that cut at the FIRST dot produced the identical string and the control
// passed under it. A control that cannot tell the two rules apart is not a
// control, and it passed because the name was wrong, not because the rule was.
// Measured on element-plus, the population this protects: 3 `build.config`
// modules plus every other `*.config.ts` and `*.d.ts` beside them.
//
// Authored from a re-probed emission; the assertion under test is the SOURCE half
// of the edges.
import { defineConfig } from "unocss";

export default defineConfig({});
export const presetName = "attributify";
