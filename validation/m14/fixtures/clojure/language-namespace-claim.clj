;; CLJ-EX2 (2026-10-20): the language-namespace claim. Rows whose target's ROOT is one of the
;; closed language/runtime namespace set (clojure · cljs · js · goog · java · javax) carry
;; metadata.languageNamespace (the declared root list) + languageNamespacePolicy="strict-absent";
;; a THIRD-PARTY root (babashka) must NOT be claimed — the list is the claim's evidence.
(clojure.string/trim " x ")
(java.time.Instant/now)
(java.io.File. "x")
(babashka.fs/exists? "x")
