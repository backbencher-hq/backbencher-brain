module Negative

import StdEnv
from Data.List import fromMaybe

// Imported/stdlib functions produce NO call edges (not declared in-file).
preludeOnly :: [Int] -> Int
preludeOnly xs = foldl (+) 0 (map (\x = x * 2) xs)

// Type variables are not calls; member access on records is not a call.
memberAccess :: User -> String
memberAccess u = u.name

// Pattern-position constructors are not instantiates.
matchOn :: OrderBook -> Int
matchOn (Book bs _) = length bs

// Where-locals are real callables: `go` is a symbol owned by `helper` (the calls below).
helper :: Int -> Int
helper x = go x
where
    go 0 = 0
    go n = n + go (n - 1)

// Guard bindings execute in the enclosing function; imported actions are not calls.
runner :: World -> World
runner world
    # y = 1
    # z = y + 1
    = startIO world

// Operator uses are patterns, not call edges.
compareOp :: Int Int -> Bool
compareOp a b = a < b || a == b

// Constructor in pattern/guard position is a pattern, not instantiates.
isBid :: Side -> Bool
isBid Bid = True
isBid Ask = False
