-- haskell/payload-and-complexity fixture — authored against probe-verified
-- tree-sitter-haskell shapes (2026-09-03). Exercises: module header + export
-- list, qualified imports, data/record/newtype, deriving, superclass context,
-- class signatures (interface methods), instance implements, operator defs,
-- backtick calls, $ application, record construction (NOT update), where
-- locals, case/conditional/guards complexity. Negatives: record UPDATE,
-- data-declaration record, imported-name calls (must emit nothing).
-- HSD12/14/16/18/19 wave: standalone deriving (bare/qualified/parens),
-- qualified constructor application, pattern-position negatives (record
-- pattern head, case alternative, pattern guard), tuple-head backtick def.

module Data.User
  ( User(..)
  , mkUser
  ) where

import Data.Text (Text)
import qualified Data.Map as Map

-- Data type with record constructors + one plain constructor: type +
-- 3 constructors + record fields. The plain alternative `Plain Int` puts a
-- `prefix` node inside data_constructor (F6 coverage); record constructors
-- parse differently and never emit prefix.
data User = Person { userName :: Text, userAge :: Int }
          | Bot { botId :: Int }
          | Plain Int
  deriving (Show, Eq)

newtype UserId = UserId Int
  deriving newtype (Show)

type Alias = Text

-- Superclass context: Mergeable extends Semigroup (single) and
-- (Show a, Eq a) => Mergeable2 (tuple of two).
class Semigroup a => Mergeable a where
  merge :: a -> a -> a

class (Show a, Eq a) => Mergeable2 a where
  merge2 :: a -> a -> Bool

-- #872's ANALYZER half (the half that never landed, found by the hledger depth
-- draw): a tuple context must yield one extends PER MEMBER, and a QUALIFIED
-- superclass head is taken VERBATIM (`Csv.ToNamedRecord`, the text the oracle
-- derives) because taking the leaf would only re-spell a MISSING edge.
class (Csv.ToNamedRecord a) => QualifiedSuper a where
  qsup :: a -> Int

class (Show a, Csv.ToNamedRecord a) => BothSuper a where
  bsup :: a -> Int

-- #872 companion, and the shape `haskell/apply-head-as-argument` names: an
-- APPLIED superclass head. The class is `Eq` (the apply's LEFT SPINE) and `(f a)`
-- is its ARGUMENT — so the edge is Applied -> Eq, never Applied -> "f a". This
-- class did not exist in the fixture, so that mutant's transform matched nothing
-- and the gate recorded it as `0 -> 0` for eleven days.
class (Eq (f a)) => Applied f a where
  applied :: f a -> Int

-- Instance: implements edge target -> class.
instance Mergeable UserId where
  merge (UserId a) (UserId b) = UserId (a + b)

-- List-parametrized instance: target resolves to [].
instance Mergeable [a] where
  merge xs ys = xs

-- Operator definition: symbol name is the operator, not the head text.
a +.+ b = a

-- Prefix operator definition.
(<!>) f x = f x

mkUser :: Text -> Int -> User
mkUser n a = Person { userName = n, userAge = a }

-- $ application + apply calls to where-locals + record construction.
buildUsers :: Text -> Int -> User
buildUsers n a = mkUser n $ double a
  where
    double x = x + x

-- Backtick call to a where-local.
pickUser :: [User] -> User
pickUser us = choose us
  where
    choose (u : _) = u
    choose [] = Bot { botId = 0 }

-- Qualified call: M.lookup.
lookupName :: Text -> Map.Map Text User
lookupName k = M.lookup k

-- Backtick call to the class method (declared via signature).
merged :: UserId -> UserId -> UserId
merged a b = a `merge` b

-- $ with a VARIABLE LHS (HSD2's exact case): calls totalUser -> describe.
totalUser = describe $ Person { userName = "x", userAge = 0 }

-- Complexity: case (2 branches), conditional, guards — describe = 4.
describe :: User -> Text
describe u = case userAge u of
  0 -> "newborn"
  _ -> if userAge u > 18 then "adult" else "minor"

signed :: Int -> Int
signed n
  | n < 0 = -n
  | otherwise = n

-- List comprehension + do-let: exercises the let/list_comprehension scoped
-- blocks (F6 coverage). Neither emits edges beyond the where-local call.
idsOf :: [User] -> [Int]
idsOf us = fromAll us
  where
    fromAll users = [userAge u | u <- users, userAge u > 0]

firstAge :: [User] -> Int
firstAge us = do
  let u = headDef us
  pure (userAge u)
  where
    headDef xs = case xs of
      (x : _) -> userAge x
      [] -> 0

-- NEGATIVE: record UPDATE on a variable head — no instantiates.
relabel :: User -> User
relabel u = u { userAge = 1 }

-- ============================================================================
-- HSD12/14/16/18/19 wave (2026-09-03 re-review, probe-verified shapes):
-- standalone deriving (bare / qualified / parens class), qualified constructor
-- application, pattern-position negatives (record-pattern head, case
-- alternative, pattern guard), tuple-head backtick infix definition.
-- ============================================================================

import qualified Data.Csv as Csv
import Data.Aeson (ToJSON)

data Ticket = Ticket { ticketId :: Int }

-- HSD12: standalone deriving instance — bare class head.
deriving instance Show Ticket

-- HSD18: standalone deriving — QUALIFIED class head (was silently dropped).
deriving instance Csv.ToNamedRecord Ticket

-- HSD12: standalone deriving — parens-wrapped class head.
deriving instance (ToJSON Ticket)

-- HSD16: body-position qualified CONSTRUCTOR application — instantiates,
-- not calls (985 corpus occurrences were previously dropped).
maybeOne :: Maybe Int
maybeOne = M.Just 1

-- HSD14: record PATTERN in a function head — pattern position, no instantiates.
nOf :: Ticket -> Int
nOf (Ticket { ticketId = n }) = n

-- HSD14: case-alternative constructor pattern — pattern position, no instantiates.
whoIs :: User -> Int
whoIs v = case v of
  Person {} -> 1
  Bot {} -> 2
  Plain _ -> 3

-- HSD14: pattern GUARD bind form — pattern position, no instantiates.
guardPick :: [User] -> Int
guardPick xs
  | Person {} <- xs = 1
  | otherwise = 0

-- HSD19: tuple-pattern head with backtick infix — `combine` is DEFINED here
-- (a function symbol), never self-called from its own head.
(a, b) `combine` r = a + r + b

useCombine :: Int -> Int -> Int -> Int
useCombine p q r = (p, q) `combine` r

-- HSD19: constructor-pattern bind — pattern-bound variables are NOT function
-- symbols and emit no edges (forbidSymbols: RightBind).
Right bindSample = Person { userName = "b", userAge = 9 }

-- ============================================================================
-- Dimension 8 (site line, M59.A7): the SAME callee from TWO distinct lines.
-- Its pins are written in PAIRS — `expectRelationshipCount` equals 2 plus both
-- lines — because a fixture that pinned one line would survive
-- `haskell/edge-line-per-set`, which keeps the FIRST site's edge and swallows the
-- second (the pre-round key was `source|type|target`, so `recount -> signed` at
-- two sites was one edge).
-- ============================================================================

recount :: Int -> Int
recount n
  | n < 0 = signed n
  | otherwise = signed n + 1

-- ============================================================================
-- Scoped local identity (M60 functional lane, 2026-09-26): a where-local is
-- NOT a module symbol, but its edges carry the lexical owner chain
-- (`owner.local`) — so a same-named module-level callable can never merge
-- with it, and target resolution is LEXICAL: an out-of-scope local is not a
-- target at all.
-- ============================================================================

go :: Int -> Int
go n = n + 1

-- No local named `go` in scope: the module-level callable is the target.
callGlobal :: Int -> Int
callGlobal n = go n

-- The where-binder SHADOWS the module-level `go` for the whole RHS: the
-- call on the RHS line resolves to the LOCAL, never to the module symbol.
shadowHost :: Int -> Int
shadowHost n = go (n + 1)
  where go x = x * 2

-- Sibling locals with the SAME name: two identities, two self-recursive
-- edges that the old bare-name identity pooled into one.
siblingA :: Int -> Int
siblingA x = hop x
  where hop y = hop (y - 1)

siblingB :: Int -> Int
siblingB x = hop x
  where hop y = hop (y + 1)

-- Cross-scope negative: `hop` is a local of siblingA/siblingB ONLY — outside
-- those scopes the name is not a callable in this file (no edge), where the
-- old flat set made any local in the file a target from anywhere.
outOfScope :: Int -> Int
outOfScope n = hop n
