// M72 — specs owned by the `specs-a` lane (18 executable code languages).
// Each entry is a LanguageSecuritySpec imported from its own file; this file is
// the lane's aggregation point only. Do not edit files outside this lane's
// language list.
import type { LanguageSecuritySpec } from "../spec-types"
import { spec as bashSpec } from "./bash"
import { spec as cSpec } from "./c"
import { spec as cleanSpec } from "./clean"
import { spec as clojureSpec } from "./clojure"
import { spec as cppSpec } from "./cpp"
import { spec as csharpSpec } from "./csharp"
import { spec as dartSpec } from "./dart"
import { spec as elixirSpec } from "./elixir"
import { spec as erlangSpec } from "./erlang"
import { spec as fsharpSpec } from "./fsharp"
import { spec as goSpec } from "./go"
import { spec as groovySpec } from "./groovy"
import { spec as haskellSpec } from "./haskell"
import { spec as javaSpec } from "./java"
import { spec as javascriptSpec } from "./javascript"
import { spec as juliaSpec } from "./julia"
import { spec as kotlinSpec } from "./kotlin"
import { spec as luaSpec } from "./lua"

/** Lane A specs, one per language; order is not significant. */
export const groupASpecs: LanguageSecuritySpec[] = [
  bashSpec,
  cSpec,
  cleanSpec,
  clojureSpec,
  cppSpec,
  csharpSpec,
  dartSpec,
  elixirSpec,
  erlangSpec,
  fsharpSpec,
  goSpec,
  groovySpec,
  haskellSpec,
  javaSpec,
  javascriptSpec,
  juliaSpec,
  kotlinSpec,
  luaSpec,
]
