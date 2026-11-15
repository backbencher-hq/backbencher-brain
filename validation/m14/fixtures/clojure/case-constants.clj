(ns clj.fixture.casec)

(defn f [k] (case k (a b) :r :d))

(defn g [k] (case k (x) (helper) :d))

;; W23 (review finding): the trailing DEFAULT of a `case` sits at index N-1 —
;; an EVEN index whenever one is present — so the constant-group parity skip
;; also swallowed list-shaped defaults. Defaults are EXPRESSIONS: both of the
;; following calls must be emitted on both sides.
(defn h [k] (case k :a 1 (helper-default k)))

(defn j [k] (case k (helper-default k)))
