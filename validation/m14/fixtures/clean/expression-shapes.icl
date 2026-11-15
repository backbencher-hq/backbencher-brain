// Clean fixture: the expression and declaration SHAPES the analyzer dispatches
// on that no earlier fixture reached. Enrolling the lane in the F6
// spec->fixture coverage gate is what surfaced them: the analyzer compares
// against case_expression/case_alternative, lambda_expression, guard_equation,
// where_block, list_comprehension, qualified_identifier, record_definition,
// record_field and the class trio, and not one of them occurred in a fixture
// parse tree — a spec claim with nothing behind it.
//
// Every construct is written the way this grammar accepts it (verified with
// script/m14/tmp/clean-fixture-probe.ts), not the way it first looked right:
// a qualified call needs the ALIAS form (`M.lookup` after `import qualified
// Data.Map as M` — the dotted `Data.Map.lookup` form is an ERROR in v1.2.7),
// and a comprehension uses the backslash separator (`[ k \\ k <- xs | k > 0 ]`).
implementation module ExpressionShapes

import StdEnv
import qualified Data.Map as M

:: Point = { x :: !Int, y :: !Int }

class Shape a where
	area :: a -> Int
	label :: a -> String

makePoint :: !Int !Int -> Point
makePoint px py = { x = px, y = py }

moveX :: !Int Point -> Point
moveX dx p = { p & x = p.x + dx }

instance Shape Point where
	area _ = 0
	label _ = "point"

describe :: !Int -> String
describe n
	| n < 0		= "negative"
	| n == 0	= "zero"
	| otherwise	= nonNegative n
where
	nonNegative :: !Int -> String
	nonNegative k = "non-negative: " ++ toString k

twice :: !Int -> Int
twice = \k -> k + k

sumSquares :: ![Int] -> Int
sumSquares xs = sum [ k * k \\ k <- xs | k > 0 ]

lookupOne :: !Int -> Int
lookupOne n = M.lookupOne n

unwrap :: Maybe Int -> Int
unwrap (Just v) = v
unwrap Nothing = 0

classify :: !Int -> String
classify n = case n of
	0 -> "zero"
	_ -> "nonzero"

// A BARE, in-file call: the most ordinary Clean call shape, and the one whose
// evidence tier is `usage_contextual` (a usage of a known binding) rather than
// `reference_qualified` (a target identified by its spelling). Every other call
// row in this fixture set is qualified, so without this pair the lane's default
// tier was unpinned.
reportTwice :: !Int -> String
reportTwice n = describeTwice (twice n)

describeTwice :: !Int -> String
describeTwice v = "twice: " ++ toString v
