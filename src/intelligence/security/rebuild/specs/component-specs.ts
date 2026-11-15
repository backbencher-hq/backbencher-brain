// M72 — component-format specs (Svelte, Vue).
//
// These are single-file component formats, not standalone languages. The AST layer
// (`pool-worker.ts`, JS_FAMILY) already extracts their `<script>` blocks as ordinary
// JS-family symbols with real byte offsets, so each spec below is written against
// script CONTENT. The component wrapper (template, style) is out of scope and is
// declared in each spec's `limits`.
import type { LanguageSecuritySpec } from "../spec-types"
import { spec as svelteSpec } from "./svelte"
import { spec as vueSpec } from "./vue"

export const componentSpecs: LanguageSecuritySpec[] = [svelteSpec, vueSpec]