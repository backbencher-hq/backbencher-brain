;; CLJ-D59 — a second definition of a name REPLACES the first one, and that is
;; the only static override Clojure has. Three shapes in one file, because the
;; rule is three questions asked in the right order:
;;   1. a real redefinition      → overrides
;;   2. a reader-conditional twin → NOT a redefinition (the reader picks one)
;;   3. declare + defn           → NOT a redefinition (a promise defines nothing)
(ns clj.fixture.redefinition)

;; 1. THE OVERRIDE. `compute-area` is defined at line 11 and again at line 14; the
;;    second form replaces the first var, so the edge is at 14 with `overridesLine` 11.
(defn compute-area [s]
  (* (:side s) (:side s)))

(defn compute-area [s]
  (Math/abs (- (:side s) (:side s))))

;; 2. THE READER CONDITIONAL. `#?(:clj … :cljs …)` is ONE definition seen from two
;;    platforms — the reader evaluates one branch and never the other, so nothing
;;    replaces anything.
#?(:clj (defn platform-pick [x] (inc x))
   :cljs (defn platform-pick [x] (dec x)))

;; 3. THE FORWARD DECLARATION. `(declare …)` interns a var with no body, so the
;;    `defn` after it is the definition and not an override of one.
(declare promised)
(defn promised [] :here)

;; A name defined twice INSIDE the conditional above is the same name twice in the
;; file, and it is still not a redefinition — the second form belongs to the branch
;; the reader did not take.
#?(:clj (def state 1)
   :cljs (def state 2))

;; A `defmethod` is NOT a redefinition: it inserts a dispatch entry into the
;; multimethod's var. Two of them share the name `area` and neither overrides the
;; other, so there is no `overrides` edge anywhere in this file except the one above.
(defmulti area :shape)
(defmethod area :circle [s] (:r s))
(defmethod area :square [s] (:side s))

;; A protocol method and a record method may share a name without either overriding
;; the other: the protocol method is an abstract declaration.
(defprotocol Sized (size-of [this]))
(defrecord Box [w]
  Sized
  (size-of [this] w))