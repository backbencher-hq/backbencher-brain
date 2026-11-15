;; CLJ-D60 — a namespace does not export a namespace.
;;
;; A MODULE symbol carries NO `ownerName`, so the export pass's
;; `s.ownerName === "" ? currentNamespace : s.ownerName` test was false for it and
;; `undefined` went into the array that indexes the edge's SOURCE. The edge pass
;; then resolved it with `?? currentNamespace` — the FILE'S LAST namespace — so any
;; file with two `ns`/`in-ns` forms published one namespace exporting the other:
;;
;;   exports temp-ns -> clojure.test-clojure.ns-libs          (ns_libs.clj)
;;   exports cond-without-else2 -> cond-without-else1          (cond_without_else.clj)
;;   exports useprotocol -> defprotocol                        (defprotocol.clj)
;;   exports bar.bar -> deprecated-var                         (deprecated_var.clj)
;;
;; Measured 40 edges over 21 files of the 633-file corpus. A module's own NAME is
;; the namespace it names, so it is the namespace an export "of" it belongs to —
;; and then the pass's existing `ns === e.name` rule refuses the edge, exactly as it
;; already refuses a Module row. Nothing is lost: the namespace reaches the graph as
;; a SYMBOL, which is what `contains` and every traversal use.
;;
;; Both spellings of "the file declares more than one namespace" are here, because
;; the corpus writes both: `(ns …)` for a file that re-opens a name, and `in-ns`
;; for the switch clojure's own pretty-printer and test files make.
(ns clj.fixture.two-ns-export.first)

(defn first-fn [] 1)

(in-ns 'clj.fixture.two-ns-export.second)

(defn second-fn [] 2)

(ns clj.fixture.two-ns-export.third)

(defn third-fn [] 3)