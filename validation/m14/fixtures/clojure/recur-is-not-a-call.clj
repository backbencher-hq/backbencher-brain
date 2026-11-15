(ns clj.fixture.recur)

;; CLJ-D42 — `recur` IS NOT A CALL, AND A SYMBOL CALLING ITSELF IS NOT A CALL.
;;
;; The analyzer used to push `calls: f -> f` with `isRecursion: true` on every
;; `recur`, manufacturing 18 such edges in clojure/core.clj alone — each one
;; `lambda_83_6 -> lambda_83_6` on a line whose head is `(recur …)`, with a target
;; that is a GENERATED name for an anonymous function. `recur` names no var, and a
;; relationship whose target cannot be navigated is a claim the graph cannot honour.
;; Recursion is real and belongs on the symbol's metadata, which is where it is.

(defn sum-to [n]
  (loop [i 0 acc 0]
    (if (<= i n)
      (recur (inc i) (+ acc i))
      acc)))

;; A direct self-call is a REAL call, and is still published — this pin is here so
;; the fix cannot be satisfied by dropping self-edges wholesale.
(defn fact [n] (if (< n 2) 1 (* n (fact (dec n)))))
