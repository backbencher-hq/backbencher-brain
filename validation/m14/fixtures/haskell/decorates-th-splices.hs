-- Fixture: decorates from declaration-position Template Haskell splices.
--
-- Template Haskell runs code at COMPILE TIME, so a declaration-position splice
-- is a real decorator application: the applied function is handed a named
-- declaration and generates members for it. Every shape below was confirmed
-- against the PINNED GRAMMAR before this expectation was written; the analysis
-- this fixture pins is the STRUCTURE, not the spelling:
--
--   * `$(makeLenses ''Widget)` and the bare `makePrisms ''Gadget` BOTH parse as
--     `top_splice` (the grammar gives declaration-position splices their own
--     node type), with an `apply` whose head is the decorator and whose argument
--     is a `th_quoted_name` carrying the quoted declaration.
--   * an ordinary `makeLenses n` inside a function body is an `apply`, never a
--     `top_splice`, so it cannot be a decoration.
--
-- FIRE (two rows, one per splice form):
--   1. `$(makeLenses ''Widget)` -> the module scope decorates the declaration
--      `Widget`, `metadata.decoratorName` = "makeLenses".
--   2. `makePrisms ''Gadget` (bare form) -> the module scope decorates `Gadget`,
--      `metadata.decoratorName` = "makePrisms".
--
-- FORBID (each is the failure the discriminator could plausibly make):
--   A. a plain application `makeLenses n` in a function body: no `decorates`.
--   B. a splice quoting an IMPORTED declaration (`''ForeignRecord`): the quoted
--      name is not declared in this file, so no edge — a decorates row here
--      would source an edge from a declaration this file does not own.
--   C. a declaration-position splice with NO callable head (`$(do pure [])`):
--      a generator, not a decorator application, so no edge.
--   D. a C-preprocessor macro line (`INSTANCE_CLUMP_1(Widget)`), which the
--      grammar parses as a bare top-level expression splice: the head is
--      callable-shaped but no `th_quoted_name` names a declaration, so no edge.

{-# LANGUAGE TemplateHaskell #-}

module DecoratesSplices
  ( Widget(..)
  , Gadget(..)
  , compute
  ) where

-- The imported decorator names are LIBRARY functions in real code; the fixture
-- imports them under those names so the head-resolution shape is the real one.
import Foreign.LensTH (makeLenses, makePrisms)

-- A record type declared HERE. A splice quoting `''Widget` therefore decorates
-- a declaration this file owns.
data Widget = Widget
  { widgetName :: String
  , widgetSize :: Int
  }

data Gadget = Gadget
  { gadgetId :: Int
  }

-- FIRE (1): the dollar form.
$(makeLenses ''Widget)

-- FIRE (2): the bare declaration form.
makePrisms ''Gadget

-- FORBID (A): a plain APPLICATION of the same decorator to a value. This is an
-- `apply` inside a function body, not a declaration-position splice — the node
-- type is what separates a call from a decoration, and there is no decoration
-- here even though the callee name is a real TH function.
compute :: Int -> Int
compute n = makeLenses n

-- FORBID (B): quoting a declaration this file does NOT declare. `ForeignRecord`
-- lives in another module, so this file cannot own the decorated declaration.
$(makeLenses ''ForeignRecord)

-- FORBID (C): a `do` block that generates declarations. It runs at compile
-- time, but it applies no callable to a named declaration — no decorator.
$(do pure [])

-- FORBID (D): a C-preprocessor macro line. The grammar parses a bare top-level
-- expression as a splice, but this one names no quoted declaration.
INSTANCE_CLUMP_1(Widget)
