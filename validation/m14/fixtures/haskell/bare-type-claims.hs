-- HSA1 — a bare capitalised dependency the module does not declare is a CLAIM, not silence.
--
-- The two largest classes of the haskell wall are the two dependencies the language spells as a
-- bare upper-case name:
--
--   instance Show Int        `Show` is `base`'s class; no corpus file declares it
--   Just x / Left e          the constructors of Maybe/Either are the language's own
--
-- MEASURED over the whole admitted population (3,702 files / 6 repos): `implements` 11,563
-- unresolved (Show 2,459 · Eq 1,899 · Generic 1,404 · Ord 703 · ToJSON 662 · FromJSON 641 · NFData
-- 530 · Hashable 327 …) and `instantiates` 10,978 unresolved (Just 3,657 · Right 1,017 · Left 617 …).
-- Every one was a dependency published with no reading at all.
--
-- The claim is `externalTarget`, and it is safe by construction: the arbiter consults a claim only
-- where the name model has NOTHING, so a name the project really declares keeps its answer.
--
-- The twins are the boundary: a class declared HERE must not be claimed, and neither must the
-- module's own constructor.

module BareClaims where

data Foo = MkFoo Int

-- A class this module declares: `instance Shape Bool` is a LOCAL dependency and must resolve.
class Shape a where
  area :: a -> Int

-- POSITIVE — `Show` is declared by no corpus file.
instance Show Int where
  show n = "n"

-- TWIN — `Shape` IS declared above, so this row must carry no claim.
instance Shape Bool where
  area _ = 0

-- POSITIVE — the language's own constructors.
justFoo :: Maybe Foo
justFoo = Just (MkFoo 1)

eitherFoo :: Either String Foo
eitherFoo = Right (MkFoo 2)

leftFoo :: Either String Foo
leftFoo = Left "nope"

-- TWIN — the module's own constructor.
mkFoo :: Int -> Foo
mkFoo n = MkFoo n
