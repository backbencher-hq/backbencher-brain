-- Fixture: `renders` and `mixes_in` are RULED for Haskell — this file is the
-- positive control for the constructs that make the ruling TRUE rather than a
-- failure to look.
--
-- The lane's whole-population census
-- (validation/m14/measurements/haskell-extended-census.json, 3,702 admitted
-- .hs/.lhs files over 6 repositories) measured:
--
--   renders    0 component-model sites. The nearest analogue — a Template
--              Haskell template LOADER that reads a template FILE — is 0 sites,
--              and a template file is not a component symbol, so the vocabulary's
--              "a component renders another component" has nothing to bind.
--   mixes_in   no mixin/trait clause exists. The grammar's 174 distinct named
--              types (253 named slots of 552 ids, served digest 37a6b07b1a83)
--              contain no such node, and the family the construct would have to
--              come from — typeclasses — is CONFORMANCE, which this file pins as
--              `extends` and `implements` below.
--
-- WHAT THIS FILE PINS, IN BOTH DIRECTIONS:
--
--   FIRE (1) `class Monad m => MonadWidget m` — a superclass constraint. This is
--            where a mixin-shaped reading would go wrong: the base is a class and
--            the relation is a single declared supertype, so it is `extends`.
--   FIRE (2) `instance MonadWidget Widget` — conformance. `implements`.
--   FORBID (A) `deriving (...) via (Sum Int)` — DerivingVia makes a type obtain
--            an implementation THROUGH a carrier type. It is conformance obtained
--            through a carrier (the instance is derived from the carrier's), and
--            it attaches NO member set and puts nothing in a supertype chain. It
--            is the closest construct in the language to a mixin, which is
--            exactly why it must not become one: 493 corpus sites, 0 of them a
--            member-set composition.
--   FORBID (B) a function that builds a markup string — a value producer, not a
--            component rendering another component: nothing is constructed by a
--            host renderer and the target would be a String, not a declaration.
--
-- A rule that fired `mixes_in` on the deriving clause, or `renders` on any
-- function returning a String, would pass a corpus count of zero and would be
-- wrong the moment the corpus contained one of these two shapes. These are those
-- shapes.

{-# LANGUAGE DerivingVia #-}

module RuledExtendedTypes
  ( Widget(..)
  , MonadWidget(..)
  , Gadget(..)
  , renderWidget
  ) where

import Data.Monoid (Sum(..))

-- FIRE (1): the superclass constraint. A class is not a mixin: it declares ONE
-- supertype in a context, which is `extends`, and its methods are a member set
-- the instances must supply — not one composed into any type.
class Monad m => MonadWidget m where
  widgetLabel :: m -> String
  widgetLabel _ = "widget"

data Widget = Widget
  { widgetId :: Int
  }

-- FIRE (2): conformance to the class. `implements`, and deliberately not
-- `mixes_in`: no member set is attached to Widget by composition; Widget
-- satisfies the class by writing the methods itself.
instance MonadWidget Widget where
  widgetLabel _ = "Widget"

-- FORBID (A): the nearest thing Haskell has to implementation composition. The
-- carrier is `Sum Int` and the obtained instances belong to it; Gadget composes
-- nothing and no supertype chain is involved.
newtype Gadget = Gadget Widget
  deriving (Semigroup, Monoid) via (Sum Int)

-- FORBID (B): a value producer. `renderWidget` returns markup TEXT; it renders no
-- component, and its target would be the String it builds.
renderWidget :: Widget -> String
renderWidget w = "<div>" ++ widgetLabel w ++ "</div>"
