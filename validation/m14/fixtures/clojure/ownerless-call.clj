;; CLJ-D47 — AN EDGE WITH NO ATTRIBUTABLE OWNER IS STILL A REAL CALL.
;;
;; `push` discarded any edge whose `from` was empty, on the reasonable-sounding
;; grounds that a relationship needs two ends. That silently deleted 43 calls across
;; the corpus, and because the discard was silent each affected file read as a
;; coverage gap rather than as a bug - the worst being test_cl_format.clj:611,
;; `(foo 3.14159)` inside a `(simple-tests ...)` block, where the owner chain ran
;; out and the edge was built and then thrown away.
;;
;; REPRODUCED HERE BY THE SMALLEST POSSIBLE FILE: no `ns` form at all, so the owner
;; chain has no namespace to fall back on. That is not a contrived case - scratch
;; files, REPL pastes and scripts routinely omit it.
;;
;; The fallback is not an invention. It is the analyzer's own C8 rule: a call outside
;; any function attributes to the namespace IN FORCE, the load-time context that
;; actually invokes it - and where there is no `ns`, Clojure's own default namespace,
;; which the analyzer spells `user`. Both calls below are attributed there.

(defn before-ns [x] (* 3 x))

(before-ns 7)

(defn after-ns [x] (* 4 x))

(after-ns 5)
