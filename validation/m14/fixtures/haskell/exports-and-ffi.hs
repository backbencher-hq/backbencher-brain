-- haskell/exports-and-ffi fixture — the module-surface and FFI shapes the
-- 2026-10-03 ontology census measured as DEFECTS, plus the negatives that pin
-- the fix. Authored from the pinned grammar's own tree shapes
-- (script/m14/tmp/hs-tree-dump.ts) before the expectation file was written.
--
-- WHAT THE CENSUS FOUND, corpus-wide, over all 14,066 admitted .hs files
-- (production `parseFile`, `script/m14/tmp/hs-ontology-analyse.ts`):
--
--   392 of 54,830 `exports` edges carried a target that was a KEYWORD or a
--   keyword phrase: 100 `type`, 32 `data`, 8 `pattern`, and the rest
--   `pattern <Ctor>` / `type <Ty>`. `exports Data.Type.Bool -> type` names a
--   keyword; nothing resolves it.
--
--   1,040 of 1,153 `foreign_import` entity texts are QUOTED string literals, and
--   the analyzer published the quotes: `references c_keepCAFsForGHCi ->
--   "keepCAFsForGHCi"`. The spelling a reader needs in the C header is
--   `RTSkeepAlive`.
--
--   409 `module_export` nodes (a `module M` RE-EXPORT) were dropped entirely,
--   even though the export list is the only place a re-export is stated at all.
--
--   1 self-named superclass edge (`class ID a => ID a`, legal under
--   UndecidableSuperClasses and present in GHC's own testsuite at
--   testsuite/tests/typecheck/should_compile/T11254.hs:12) was the single row the
--   F5 differential disagreed on, because the oracle drops structural self-edges.
--
-- Every export shape the pinned grammar produces is exercised here, so the
-- fixture covers the CASE rather than one instance of it:
--
--   export -> name                      `Widget(..)`, `render`
--   export -> variable                  `plainName`
--   export -> namespace + name          `type WidgetId`      (was `type WidgetId`)
--   export -> namespace + prefix_id     `type (&&)`          (was `type (&&)` -> `type`)
--   export -> namespace + prefix_id     `pattern (:|)`       (constructor_operator)
--            -> constructor_operator
--   export -> variable (keyword only)    `data Gadget`        (grammar mis-parse: the
--            + ERROR sibling                                       name lands in the ERROR)
--   module_export                       `module Data.Gadget` (the re-export)

module Data.Surface
  ( Widget(..)
  , render
  , plainName
  , type WidgetId
  , type (&&)
  , pattern (:|)
  , data Gadget
  , class Surface
  , module Data.Gadget
  ) where

import Data.Text (Text)

-- `type WidgetId` — a namespace-qualified type synonym export. The name is
-- `WidgetId`; the grammar keeps `type` in a `namespace` child.
type WidgetId = Int

-- `type (&&)` — a namespace-qualified OPERATOR synonym export. The grammar puts
-- the name in `prefix_id -> operator`.
type (&&) :: Bool -> Bool -> Bool
(&&) a b = a && b

-- `pattern (:|)` — a pattern-synonym export under its CONSTRUCTOR operator
-- (`prefix_id -> constructor_operator`).
pattern (:|) :: [Int] -> [Int] -> [Int]
pattern xs :| ys = xs ++ ys

-- `data Gadget` — the export entry whose only named child is the keyword
-- `variable("data")`, with `Gadget` in the sibling ERROR. Recoverable: the
-- expectation pins `exports Data.Surface -> Gadget`.
data Gadget = Gadget Int

-- `class Surface` — same mis-parse, and a class declaration for the
-- implements/extends rows.
class Surface a where
  surfaceName :: a -> Text

instance Surface Widget where
  surfaceName _ = "widget"

-- `Widget(..)` — the ordinary constructor-list form. `Widget` is the type the
-- module exports; the constructor list is a visibility detail, not a name.
data Widget = Widget { widgetLabel :: Text, widgetParts :: [Int] }

render :: Widget -> Text
render w = widgetLabel w

-- An ordinary lowercase name in the export list: `export -> variable`.
plainName :: Text
plainName = "plain"

-- NAMES the pins FORBID, and why.
--   `type WidgetId`  — the KEYWORD, not the name. A name-bearing field holding a
--                      keyword is an endpoint that exists in no source file.
--   `pattern Just`   — ditto, and there is no such name here at all.
--   `data Gadget`    — ditto.
--   `class Surface`  — ditto.
--   `-- * docs`      — a Haddock comment in an export list is not a name (the
--                      M60-HK class: 39 such edges corpus-wide).

-- ============================================================================
-- FFI. `foreign import capi "libwidget.h" "widget_alloc" c_widgetAlloc`.
-- The C entity is a string LITERAL, so the grammar's `entity` node text is
-- `"widget_alloc"` WITH its quotes. The expectation pins the unquoted spelling,
-- which is the one a reader greps for in the C header.
-- ============================================================================

foreign import capi "libwidget.h" "widget_alloc"
  c_widgetAlloc :: IO Int

-- NEGATIVE: an entity that is NOT a quoted literal keeps its own text. The
-- `stripQuotes` rule only removes a matched pair of double quotes, so a bare
-- entity must survive unchanged — pinned by `references c_widgetVersion ->
-- widget_version`.
foreign import capi "libwidget.h" widget_version
  c_widgetVersion :: IO Int

-- Two imports from the same entity text on DIFFERENT lines: the site line is part
-- of the dedupe key (dimension 8), so these are two edges at two lines and a
-- per-set regression cannot collapse them unnoticed.
c_doubleAlloc :: IO Int
c_doubleAlloc = c_widgetAlloc 2

c_tripleAlloc :: IO Int
c_tripleAlloc = c_widgetAlloc 3

-- ============================================================================
-- Self-superclass. Legal under UndecidableSuperClasses, and GHC's own testsuite
-- writes it (T11254.hs:12). The `extends` edge is NOT published: a self-named
-- edge collapses into a self-loop in symbol-ID space, which is the same reason
-- the `contains` post-loop skips self-named edges, and it was the only
-- `extends` row the F5 oracle and the analyzer disagreed on (1 UNEXPLAINED of 98
-- over a 1,200-file stride draw).
-- ============================================================================

-- A NON-self superclass, so the fixture pins the positive `extends` row as well
-- as the suppressed self row. `Widget` extends `Surface` (declared above).
class Surface a => Recursive a where
  depthOf :: a -> Int

instance Recursive Gadget where
  depthOf _ = 0