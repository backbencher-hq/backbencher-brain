(ns clj.fixture.deflike)

;; CLJ-D30 — a def-like head in DEF POSITION DEFINES A NAME.
;;
;; All three shapes below produced NO symbol, NO `contains` edge and NO export
;; before this class was fixed. 1,136 top-level definitions across the four
;; corpora were affected.
;;
;; F1's node-type census is structurally blind to this: an unrecognized def form
;; parses as an ordinary `list_lit`, i.e. a CALL, so a census of node types
;; cannot see a form the analyzer never recognized as a definition.

;; 1. A THIRD-PARTY macro — `defcurried` is a real clojure.core macro, and all
;;    eight of its definitions in clojure/core/reducers.clj recorded nothing.
;;    That file defines `map`, `mapcat`, `filter`, `remove`, `take`,
;;    `take-while`, `drop` and `flatten` this way.
(defcurried curried-map
  "Applies f to every value in coll."
  [f coll]
  (map f coll))

;; 2. A LOCAL macro, defined in this very file. This is the shape a per-file
;;    analyzer can never have been taught by hand, and it accounts for 1,043 of
;;    the sites — `defsetting`, `defenterprise`, `defclause`, `deferror`,
;;    `defspec`, `defroutes` in metabase, plus `def-aset`, `definline`,
;;    `defblockingop` and `deftest-both` in clojure's own sources.
(defmacro def-alias2
  [nm value]
  `(def ~nm ~value))

(def-alias2 local-alias 42)

;; 3. A CORE-NAMED definition macro. `definline` is a clojure.core macro
;;    (core.clj:5461), so it IS in the derived core list — and the first version
;;    of the fix excluded core-named heads, which threw away `(definline
;;    booleans …)` at core.clj:5580 and six siblings, the typed-array coercions.
(definline inline-only [xs] xs)

;; NOT a definition. `def` with a plain symbol is the ordinary case and must
;; keep working exactly as before: a Variable, contained, exported, no call edge
;; to the macro name itself.
(def plain-value 1)

;; A def-like NAME in argument position is still not a definition: `val` here
;; names the macro's parameter, and calling it is a call to `val`.
(defmacro wrapper2 [val] (val 1))
(wrapper2 inc)
