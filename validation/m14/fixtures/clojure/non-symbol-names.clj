;; A3 (2026-10-20): a STRING literal or a READER-CONDITIONAL node in the name position is
;; not an identifier. The defect rows published the node TEXT as a name (10 exports + 15
;; contains at whole population); the fix publishes nothing for such a declaration.
(ns fixture.non-symbol-names)

(defn "bad docstring" testname [arg1 arg2] arg1)

(defn #?@(:clj [rc-name] :cljs [^boolean rc-name]) [] 1)

(defn ok-name [] 1)
