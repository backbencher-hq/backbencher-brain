;; clojure/error-recovery — the ERROR node is a HANDLED shape, not a parse failure.
;;
;; The completeness spec has carried `ERROR` in clojure's handled_verified set since the
;; lane's first census ("a damaged region is parsed, not omitted"), but no fixture ever
;; produced one, so the fixture-coverage gate reported it UNCOVERED and the claim was
;; unfalsifiable. This file is deliberately MALFORMED: the second form is missing its
;; closing delimiter, so tree-sitter-clojure emits an ERROR node for the damaged region
;; while the first (well-formed) form still parses. The analyzer must publish the intact
;; declaration and must not fabricate anything out of the damaged tail.
(ns error-recovery)

(defn intact [x] (+ x 1))

(defn damaged [y] (+ y 1)
