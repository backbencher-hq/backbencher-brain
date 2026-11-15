-- haskell/ffi-entity-and-instance-target fixture — the three shapes the
-- 2026-10-03 verification round measured as DEFECTS on the GHC corpus, plus the
-- controls that say a fix did not over-reach.
--
-- WHAT THE ROUND FOUND (all counts are production `parseFile` over the corpus,
-- instruments in script/m14/tmp/hs-verify-*.ts; see the lane doc):
--
--   1. FFI HEADER. Over the 1,356 quoted FFI literals GHC writes, 391 carry a
--      HEADER AND THE C NAME IN ONE STRING, and the analyzer published the
--      header as the symbol:
--        references log1pDoubleOld -> "math.h log1p"     <- a FILE NAME
--        references functionInC    -> "T15933.h function_in_c"
--      Haskell 2010 F.3.2.1: `impent -> 'static' [chname] [&] [cid] | string`,
--      and in the string form the header and the entity share one literal.
--      Corpus: testsuite/tests/codeGen/should_run/cgrun078.hs:21,
--      testsuite/tests/ffi/should_run/T15933.hs:8.
--
--   2. FFI `&`. 42 of the same literals are `&`-prefixed — Report F.3.2.1's
--      `[&]`, meaning "pass the address of this entity", not part of its
--      spelling. Corpus: compiler/GHC/Types/Unique/Supply.hs:280 publishes
--      `references ghc_unique_counter64 -> "&ghc_unique_counter64"`.
--
--   3. FFI `javascript`. Over a stride-12 draw (1,170 files, 62 `foreign_import`
--      nodes) 13 of 13 `javascript` nodes bind a JAVASCRIPT BODY and not one names
--      an entity — yet 8 of them SHIPPED as `references` edges, because a JS
--      snippet contains none of the characters the production noise filter bans:
--        references js_print -> "console.log($1)"
--        references js_req_to_str -> "$1.text($2)"
--      Corpus: testsuite/tests/jsffi/http.hs:18-45.
--
--   4. QUALIFIED INSTANCE TARGET — a GAP, not a defect: the language expresses it
--      and the analyzer could not read it. `instance TrieMap IntMap.IntMap` is
--      `type_patterns -> qualified("IntMap.IntMap")`; no branch matched,
--      `targetType` stayed empty, so the instance SYMBOL was published under the
--      CLASS's own name (a second symbol named `TrieMap` beside the file's
--      `class TrieMap`) and `implements IntMap.IntMap -> TrieMap` was never
--      emitted. Corpus: compiler/GHC/Data/TrieMap.hs:139 and
--      compiler/GHC/Types/Unique/DSM.hs:158 (`instance MonadGetUnique
--      USM.UniqSM`).
--
-- EVERY SHAPE THE PINNED GRAMMAR PRODUCES IS EXERCISED HERE, so the fixture
-- covers the CASE rather than one instance of it.

module Surface.FFI
  ( Widget(..)
  , render
  , log1pWrapper
  , uniqueCounter
  , jsAdd
  , c_widgetVersion
  ) where

import Data.Text (Text)

data Widget = Widget { widgetLabel :: Text, widgetParts :: [Int] }

render :: Widget -> Text
render w = widgetLabel w

-- CONTROL: an ordinary C-convention FFI whose literal is the NAME ONLY. Untouched
-- by every rule below — pinned so a fix cannot be "passes because it returns
-- something" rather than because it returns the right thing.
foreign import ccall unsafe "widget_alloc"
  c_widgetAlloc :: IO Int

-- CONTROL: the two standard stdcall/ccall entity names the Report defines
-- (`wrapper` and `dynamic`). Both ARE entity names and must be published —
-- `foreignEntityName`'s javascript branch must not swallow them.
foreign import stdcall "wrapper"
  c_wrap :: IO Int

foreign import ccall "dynamic"
  c_dynamic :: IO Int

-- (1) HEADER + NAME IN ONE LITERAL, `capi`. The C entity is `log1p`; `math.h` is
-- the header. Corpus: testsuite/tests/codeGen/should_run/cgrun078.hs:21.
foreign import capi unsafe "math.h log1p"
  log1pWrapper :: Double -> IO Double

-- (1b) The same shape on `ccall`, so the rule is not tied to one convention.
-- Corpus: testsuite/tests/rts/linker/T20918.hs:8.
foreign import ccall unsafe "test_error_throwing.h equivalent_to_id"
  c_equivalentToId :: IO Int

-- (2) `&` ADDRESS-OF PREFIX. The C entity is `ghc_unique_counter64`; the `&` is
-- Report F.3.2.1's `[&]` and is not part of the spelling. Corpus:
-- compiler/GHC/Types/Unique/Supply.hs:280.
foreign import ccall unsafe "&ghc_unique_counter64"
  uniqueCounter :: IO Word64

-- (3) `javascript` FFI. The literal is a JavaScript BODY and names no entity, so
-- NO `references` edge is published. The Haskell binding below is still a real
-- symbol and is still contained by the module — the fix withholds the edge that
-- asserts an external entity, not the declaration.
foreign import javascript unsafe "function add($1, $2) { return $1 + $2; }"
  jsAdd :: Int -> Int -> IO Int

-- CONTROL: a bare entity that is NOT a quoted literal keeps its own text. The
-- quote-stripping rule removes a matched pair of double quotes only.
foreign import ccall unsafe "widget_version"
  c_widgetVersion :: IO Int

-- ============================================================================
-- QUALIFIED INSTANCE TARGET. `type_patterns -> qualified`, taken VERBATIM
-- because that is how the source writes it and this lane's standing convention
-- for a qualified head (qualified CALLS publish the full `M.lookup`; the Erlang
-- `gen_server:cast` precedent).
-- ============================================================================

class Surface a where
  surfaceName :: a -> Text

instance Surface Widget where
  surfaceName _ = "widget"

-- The CONTROL: an ordinary in-file instance target, pinned so the qualified
-- branch cannot be "passes because it names something".
instance Surface [Int] where
  surfaceName _ = "ints"

-- The GAP. Corpus: compiler/GHC/Data/TrieMap.hs:139.
instance Surface Store.Map where
  surfaceName _ = "store"
-- The REGRESSION GUARD for the qualified fix. A MULTI-PARAMETER class instance
-- has SEVERAL type patterns, and this lane publishes ONE target. The rule is the
-- FIRST type pattern (the Rust `impl User` / Elixir `defimpl` naming contract),
-- and the fix reads position rather than node TYPE — so a LATER qualified pattern
-- must not hijack the target.
--
-- The first version of the fix added "qualified" to the type-scanning list, which
-- let the second pattern win and moved 2 `implements` + 5 `overrides` edges onto
-- the wrong type across the corpus:
--   compiler/GHC/HsToCore/Quote.hs:1239
--     instance RepTV (HsBndrVis GhcRn) TH.BndrVis      [0] parens  [1] qualified
--   compiler/GHC/ThToHs.hs:1600
--     instance CvtFlag TH.BndrVis (HsBndrVis GhcPs)    [0] qualified  [1] parens
class Convertible src dst where
  convert :: src -> dst

instance Convertible [Char] Text where
  convert = id

-- First pattern is PARENTHESISED (this is exactly the corpus shape that moved
-- edges: compiler/GHC/HsToCore/Quote.hs:1239 `instance RepTV (HsBndrVis GhcRn)
-- TH.BndrVis` has type_patterns [0]=parens [1]=qualified), second is QUALIFIED.
-- The target must be the left-spine head of the parens, `Maybe`, and must NEVER
-- become `Store.Map`.
instance Convertible (Maybe Widget) Store.Map where
  convert = convertStore
