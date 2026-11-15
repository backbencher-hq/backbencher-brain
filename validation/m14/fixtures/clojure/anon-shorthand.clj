;; CLJ-D20 — the anonymous-argument shorthands, and the LAST regex in the lane.
;;
;; `/^%(\d+|&)?$/` decided whether a `#(…)` head was a parameter reference
;; rather than a callee, and it was the last regex `reviews/regex-policy.md`
;; carried for clojure — registered with the note "mechanically convertible to
;; a structural symbol-name check". It is a char scan now
;; (`isAnonArgShorthand`), and the conversion is PROVED, not asserted:
;; `script/m14/tmp/clj-regex-equiv.ts` runs the regex and the scan over every
;; `sym_lit` name in three corpora (633 files, 187,678 symbol nodes, 13,363
;; distinct names) plus a 42-case adversarial battery (`%%`, `%&x`, `%0`,
;; `%00`, `%١`, `% 1`, `%1a`, a twenty-digit `%…`) and reports 0 mismatches.
;;
;; The fixture pins the OBSERVABLE half — an accepted shorthand head emits no
;; call — and the boundary from the other side: `%&x` and `%1a` are NOT
;; shorthands, so the analyzer reads them as callees. Those two heads are
;; deliberately malformed Clojure, kept because a filter that is too greedy is
;; only observable through them; a head that merely *looks* like a shorthand
;; cannot be written in real Clojure, which is why the adversarial battery
;; lives in the probe rather than here.
(ns clj.fixture.anonshorthand)

(defn helper [x] (inc x))

;; ── accepted shorthands: no `calls` edge for any of them ────────────────
(defn bare-shorthand [xs] (map #(% 1) xs))
(defn rest-shorthand [xs] (map #(%& 0) xs))
(defn two-args [xs] (map #(+ %1 %2) xs))
(defn many-args [xs] (map #(+ %1 %2 %3) xs))

;; ── a real callee survives the filter ───────────────────────────────────
(defn real-callee [xs] (map #(helper %) xs))
(defn qualified-callee [xs] (map #(clojure.core/inc %) xs))

;; ── rejected near-misses: read as callees ───────────────────────────────
(defn greedy-rest [xs] (map #(%&x 0) xs))
(defn greedy-digit [xs] (map #(%1a %2) xs))
