;; A4 (2026-10-20): `(declare …)` is a forward declaration, not a definition (CLJ-D23 —
;; the export and override passes already excluded it; `contains` did not, 25 rows whole
;; population). The DEFINING form keeps its containment edge.
(ns fixture.declare-containing)

(declare ^:dynamic *x* fwd)

(defn fwd [] 1)

(defn real [] *x*)
