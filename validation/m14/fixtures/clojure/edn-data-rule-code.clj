;; CLJ-EX3 (2026-10-20): the CODE twin of edn-data-rule.edn — the same forms in a .clj file are
;; real calls and keep their rows (and the language-namespace claim for clojure.test/is).
(shell "echo hi")
(clojure.test/is true)
(clojure.test/testing "x" (is true))
