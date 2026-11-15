module Negative where

import Data.Maybe (fromMaybe)
import Data.List (foldl')

-- Imported/Prelude functions produce NO call edges (not declared in-file).
preludeOnly :: [Int] -> Int
preludeOnly xs = foldl' (+) 0 (map (* 2) xs)

-- Type variables are not calls; member access on records is not a call.
memberAccess :: User -> String
memberAccess u = name u

-- Pattern-position constructor applications are not instantiates.
matchOn :: OrderBook -> Int
matchOn (OrderBook bs _) = length bs

-- where-locals: no symbol, but a local's body attributes its calls to the LOCAL (not to the enclosing function) and a local resolves as a call target — `helper -> go`, `go -> go`; identity caveat (bare names) in ground-truth/haskell.json's source.
helper :: Int -> Int
helper x = go x
  where go 0 = 0
        go n = n + go (n - 1)

-- do-notation binds execute in the enclosing function; imported actions are
-- not calls.
runner :: IO ()
runner = do
  let y = 1
  z <- pure y
  print z

-- Operator uses are patterns, not call edges.
compareOp :: Int -> Int -> Bool
compareOp a b = a < b || a == b

-- Constructor in guard/condition position is a pattern, not instantiates.
isBid :: Side -> Bool
isBid Bid = True
isBid Ask = False
