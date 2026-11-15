;; CLJ-D50 — A FILE WITH NO `ns` FORM HAS ITS DEPENDENCIES ATTRIBUTED TO `user`.
;;
;; `nsAt` returns "" when there is no `ns` form to be in force, and the analyzer
;; attributes those references to Clojure's default namespace. Without the
;; fallback this published `references||…` — a dependency edge with a BLANK source,
;; 70 of them in this corpus, which is a relationship with only one end.
;;
;; CLJ-D47 taught this to the `calls` derivation; this is the `references` half, and
;; the two having drifted apart is the same lesson as the alias tables: one fact,
;; two derivations, two answers.
(require '[clojure.string :as string])

(defn shout [s] (string/upper-case s))
(shout "x")
