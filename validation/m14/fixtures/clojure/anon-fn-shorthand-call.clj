(ns clj.fixture.anon-shorthand)

;; CLJ-D45 — `#(f …)` IS A CALL TO `f`, AND THE WALK NEVER VISITED IT.
;;
;; `#(h %)` parses as an `anon_fn_lit` whose children are the body DIRECTLY: there
;; is no `list_lit` and no `fn` head, so a walk that fires on lists never sees it.
;; This is not a curiosity. clojure/core.clj is written in the shorthand, and 55 of
;; the residual edges in this wave were calls written this way — `#(shift-mask s m
;; %)`, `#(seq-reduce …)`, `#(foldvec …)`. The analyzer names the shorthand
;; `lambda_<row>_<col>` from the node's own position, so the `fn` owner rule has to
;; apply here too or the edge is attributed to the enclosing defn.

(defn twice [x] (* 2 x))

;; The call lives inside the shorthand, and is attributed to the LAMBDA.
(defn applied [xs] (map #(twice %) xs))

;; The mirror case, and the reason the head needs a name test: `#(% 1)` APPLIES its
;; argument rather than calling it, so `%` is a placeholder and not a callee. It is
;; the same node shape as the line above and the opposite answer.
(defn applied-arg [f xs] (map #(% 1) xs))

;; CLJ-D46 — AND THE SHORTHAND MUST ROUTE INTEROP HEADS THE WAY THE LIST PATH
;; DOES. Written plainly, `(.getName o)` is a MEMBER ACCESS and emits `uses:
;; getName`. Written as `#(.getName %)`, the same expression took the shorthand's
;; head path and pushed `calls: lambda -> .getName` — a call edge to a name that
;; starts with a dot, is not a var in the file, and is not an export. That was 19
;; fabricated `calls` edges, and it was invisible to the differential because the
;; truth ALSO files these under `uses`: the two agreed on the ontology and
;; disagreed only on whether the shorthand had been analysed at all.
(defn named [os] (map #(.getName %) os))

;; A static member through the shorthand carries the same second fact the plain
;; form does — WHICH CLASS — so it emits both edges too.
(defn trimmed [ss] (map #(String/.trim %) ss))
