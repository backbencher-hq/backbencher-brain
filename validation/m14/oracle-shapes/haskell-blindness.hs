-- | Shapes the Haskell ORACLE was historically blind to.
--
-- Four times in this lane's history an "unexplained relationship" turned out to
-- be the CHECKER failing to see a declaration the analyzer had published
-- correctly and completely:
--
--   1. an operator-named top-level binding (`//`, `<@>`)  -- declName required
--      a `variable` head, so an `infix`/`operator` head was skipped outright;
--   2. a CURRIED parameterized instance target `(Set' sep b a)` -- the target
--      nests `apply`s, so a one-level descent fell back to the whole text
--      "Set' sep b";
--   3. a GeneralizedNewtypeDeriving declaration (`newtype instance`) -- a node
--      type the oracle did not mention at all;
--   4. a QUALIFIED type head `(Parsec.ParsecT s u m)` -- dropping the qualifier
--      published an unresolvable bare "ParsecT".
--
-- A checker that cannot see a symbol is indistinguishable from an analyzer that
-- does not emit one, and that is how three phantom "analyzer defects" and one
-- real phantom were each reported before the parse tree was read. This file
-- exists so the next blind spot fails a criterion instead of being discovered by
-- accident.
module Data.Blindness (Described(..), merge, wrap) where

import qualified Data.Parsec as Parsec

-- SHAPE 1 — an operator-named top-level binding. `//` is an ordinary, frequently
-- defined function; requiring a `variable` head erased it from the truth side.
(//) :: [a] -> [a] -> [a]
xs // ys = xs ++ ys

-- An operator defined in point-free/prefix position, the other spelling.
(<@>) :: (a -> b -> c) -> a -> b -> c
f <@> x = f x

infixr 5 //
infixl 7 <@>

-- SHAPE 2 — a curried parameterized instance target. The head is
-- apply(apply(apply(name "Set'", sep), b), a): the target is "Set'", never
-- "Set' sep b".
data Set' sep b a = Set' [a]

class Described c where
  describe :: c -> String

instance Described (Set' sep b a) where
  describe _ = "set"

-- SHAPE 3 — a GeneralizedNewtypeDeriving declaration. Parses as
-- data_instance -> newtype -> name "Static" / type_patterns / newtype_constructor.
-- The oracle had no branch for `data_instance` at all, so it derived nothing.
class Static s where
  staticKey :: s -> Int

data User = User

newtype instance Static User fnTy = UserStatic
  { userStaticPtr :: Int
  }

-- SHAPE 4 — a QUALIFIED type head. The spine terminates in a `qualified` node
-- carrying module "Parsec." + name "ParsecT"; the qualifier is part of the name.
class CharParsing c where
  satisfy :: c -> Int -> Maybe Int

instance CharParsing (Parsec.ParsecT s u m) where
  satisfy _ _ = Nothing

-- SHAPE 5 — an operator-named binding inside a `where` block, published by the
-- analyzer under the MODULE but derived by the oracle under the local scope.
-- The 22 rows still open in criterion 9.
wrap :: a -> a
wrap = go
  where
    go x = x <?> x
    (<?>) :: a -> a -> a
    x <?> y = x
