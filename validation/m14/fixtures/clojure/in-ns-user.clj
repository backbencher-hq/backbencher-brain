;; CLJ-D34, half one — `user` IS A REAL NAMESPACE WHEN THE FILE SAYS SO.
;;
;; The export/containment pass skipped every symbol whose owner was `user`, so a
;; file could not claim a `user` namespace it never declared. But `(in-ns 'user)`
;; at clojure/core/server.clj:169 DECLARES one, and the eight definitions after
;; it belong to it — 36 real containment edges were being lost, and
;; clojure/core/server.clj's `repl-read`, `repl`, `prepl`, `ex->data` and four
;; more had no containment at all.
(in-ns 'user)

(defn declared-user-fn [x] (+ x 1))

(def declared-user-var 42)
