;; CLJ-D28 — a qualified name whose OWN NAME contains a slash.
;;
;; metabase calls `h2x//` — `[metabase.util.honey-sql-2 :as h2x]` and a
;; function named `/`, so the qualified name is `h2x` + `/` + `/` = `h2x//`. The
;; grammar says so structurally: the `sym_lit` carries `namespace: "h2x"` and
;; `name: "/"`. The analyzer was splitting the TEXT a second time, TWICE and
;; differently: `"h2x//".split("/")` is `["h2x","",""]`, so the generic-call
;; branch published `…honey-sql-2/`, while `resolveQualified` (slice after the
;; first slash) published `…honey-sql-2//`. Two answers for one call site, inside
;; one analyzer, and the F5 oracle mirrored only one of them.
;;
;; The shape is invisible to a 60-file draw: it needs a function whose name ends
;; in a slash. The FULL-EXTENT run over metabase's 4,252 Clojure files is what
;; found it — 2 unexplained of 239,192 truth edges, both this shape.
;;
;; The fix is the AST-first rule applied where the AST already has the answer:
;; every qualified callee is read from the head node's `namespace`/`name`
;; fields, so the three emission shapes cannot disagree again.
(ns clj.fixture.qualifiednames
  (:require [app.lib :as a]
            [app.deep :as a/b]))

;; generic call
(defn generic [x] (a/join x))
(defn slash-named [x] (a// x))
(defn twice-slash-named [x] (a/b// x))

;; thread step
(defn threaded [x] (-> x (a// ) (a/join )))

;; `#(a// %)` shorthand
(defn shorthand [xs] (map #(a// %) xs))
