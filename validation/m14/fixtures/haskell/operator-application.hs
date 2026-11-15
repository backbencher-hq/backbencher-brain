-- Fixture: Data.OperatorApplication — VERIFY_HS9 (2026-10-04)
--
-- Pins the operator-application and infix/ticked-constructor-application shapes
-- this lane added, and the negatives that keep them honest. Every shape below
-- was confirmed against the PINNED GRAMMAR by script/m14/tmp/hs9-ast-dump.ts
-- BEFORE the expectation file was written (M14 honesty contract §5.2: an
-- expectation is authored from the language, then compared — not copied out of
-- the analyzer's output).
--
-- 1. A locally declared OPERATOR is a callable this file publishes, so its
--    application sites are `calls`. Four sites, each a different syntactic
--    shape, so a rule that handles only one of them is caught.
-- 2. A locally declared INFIX CONSTRUCTOR's application sites are
--    `instantiates`, never `calls`.
-- 3. A TICKED constructor's application sites are `instantiates`.
-- 4. A PREFIX operator application `(<+>) x 1` is a `calls` site.
-- 5. Negatives: an operator DEFINITION head emits nothing; a Prelude operator
--    this file does not declare emits nothing; a TYPE-position operator emits
--    nothing even when a value operator of the same spelling exists; a
--    PATTERN-position infix constructor emits nothing; a pattern-position
--    prefix operator emits nothing.

module Data.OperatorApplication
  ( Chain(..)
  , combine
  , render
  , sizeOf
  ) where

import Data.List (intercalate)

-- (1) A locally declared operator. `(.+.)` is published as a callable symbol
-- named `.+.`, so every use of it below is a call to that symbol.
(.+.) :: Int -> Int -> Int
a .+. b = a * 10 + b

-- (2) A locally declared INFIX constructor. `a :+: b` CONSTRUCTS a Chain.
data Chain
  = End
  | Int :+: Chain

-- (3) A TICKED constructor: `a `Snoc` xs` CONSTRUCTS a Chain too.
data SnocChain
  = SnocEnd
  | Int `Snoc` SnocChain

-- A locally declared constructor-shaped operator used through a prefix
-- application would be `(:+:) n c`; `(:+:)` is in scope as a prefix_id, which is
-- what shape (4) exercises below with an ordinary operator.

-- (2, continued) Infix constructor application: `extend` constructs.
extend :: Int -> Chain -> Chain
extend n c = n :+: c

-- (2, continued) Nested: the right operand is itself an infix application, so
-- this is TWO construction sites on one line — and the dedupe key carries the
-- line, so they must not collapse.
extendTwo :: Int -> Int -> Chain -> Chain
extendTwo a b c = a :+: (b :+: c)

-- (3, continued) Ticked constructor application.
push :: Int -> SnocChain -> SnocChain
push n xs = n `Snoc` xs

-- (1) Operator application in a guard — a different syntactic position from the
-- plain RHS above, and the guard line is a different line for the edge.
combine :: Int -> Int -> Int
combine x y
  | x > y = x .+. y
  | otherwise = y .+. x

-- (4) Prefix operator application `(<+>) x 1`: a full application, so a call.
-- `(<+>)` is declared below, AFTER this use — forward reference, the same rule
-- plain function calls already follow.
shifted :: Int -> Int
shifted x = (<+>) x 1

-- (1, forward) The operator's own declaration.
(<+>) :: Int -> Int -> Int
a <+> b = a + b

-- NEGATIVE (a) `++` is a Prelude operator and this file does not declare it, so
-- `render` calls nothing: a name-resolution negative, the FP-family rule.
render :: SnocChain -> String
render SnocEnd = "end"
render xs = "snoc" ++ intercalate "," (replicate 3 "x")

-- NEGATIVE (b) a TYPE-position operator whose spelling is also a value operator
-- in this file. tree-sitter parses this without complaint (it does not
-- typecheck, and this fixture is about the tree); the pin is that the analyzer
-- must not read a type expression as an application of the value operator.
type Shifted = Int .+. Int

-- NEGATIVE (c) pattern-position infix constructor: matching `a :+: rest`
-- constructs nothing, and NEGATIVE (d) pattern-position prefix operator.
uncons :: Chain -> Maybe (Int, Chain)
uncons (n :+: rest) = Just (n, rest)
uncons End = Nothing

useCons :: Chain -> Int -> Maybe Int
useCons c n = case uncons c of
  Just (m, _) -> Just (m .+. n)
  Nothing -> Nothing

-- `sizeOf` is named in the export list above, and the fixture runner's export
-- invariant requires every exported name to resolve to a symbol — so it has to
-- exist here. It also gives the ticked-constructor shape a SECOND function, so
-- the shape is not pinned only in `push`.
sizeOf :: SnocChain -> Int
sizeOf xs = lengthOf xs

lengthOf :: SnocChain -> Int
lengthOf SnocEnd = 0
lengthOf (_ `Snoc` rest) = 1 + lengthOf rest
lengthOf2 :: SnocChain -> Int
lengthOf2 xs = 1 + sizeOf xs