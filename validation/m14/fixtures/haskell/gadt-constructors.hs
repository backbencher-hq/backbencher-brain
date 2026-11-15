-- M14.0.F6 haskell coverage (2026-10-08).
--
-- The lane's completeness spec lists 53 handled_verified node types and F6
-- requires every one of them to OCCUR in a fixture's parse. `gadt_constructor`
-- was the last one no fixture reached: a data declaration whose constructors are
-- written in the `where`-headed GADT form. The four existing fixtures cover
-- exports/FFI, operator application, payload and complexity — none of them
-- declares a GADT, so the type could not occur however the analyzer behaved.
module GadtConstructors
  ( Shape (..)
  , Describable (..)
  ) where

data Shape a where
  Circle :: Double -> Shape Double
  Square :: Double -> Shape Double
  Named :: String -> Shape String

-- A class constrained by a GADT-typed argument, so the construct sits next to
-- an ordinary signature rather than in a file of nothing but GADTs.
class Describable a where
  describe :: a -> String

instance Describable (Shape Double) where
  describe shape =
    case shape of
      Circle _ -> "circle"
      Square _ -> "square"
