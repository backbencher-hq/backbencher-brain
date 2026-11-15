module CtorInstantiation

// DATA CONSTRUCTOR APPLICATION — the construct behind the `instantiates` kind.
// A constructor DECLARED IN THIS FILE and applied in BODY position is an
// instantiation; the same constructor in PATTERN position is a match and is
// emitted as `uses`. This fixture exists because the contract row names
// `instantiates` while no other clean fixture exercised it, so section B's
// reverse check had a kind the lane publishes that no expectation pinned.
// The in-file rule is deliberate: a constructor from another module cannot be
// proven to be a constructor by a single-file analyzer, so those applications
// are declined and counted in `declinedInstantiations` (see the analyzer).

:: Tree = Leaf Int | Node Tree Tree

mkLeaf :: Int -> Tree
mkLeaf n = Leaf n

mkNode :: Tree Tree -> Tree
mkNode l r = Node l r

weight :: Tree -> Int
weight (Leaf n) = n
weight (Node l r) = weight l + weight r
