(ns clj.fixture.activefn)

;; CLJ-D51 — THE SOURCE IS THE ANALYZER'S `activeFunction`, AND IT IS NOT THE SAME
;; THING AS `walk`'s OWNER.
;;
;; CLJ-D48 derived this rule inside the type-relation derivation. `instantiates` was
;; still reading `walk`'s owner — a different question — and disagreed on 299 edges.
;; One language fact, two derivations, two answers: the same lesson as the four alias
;; tables, and the reason the pre-pass now lives at module scope where the next
;; derivation can find it. These are the three positions where the two disagree.

;; `defn` TAKES ITS OWN NAME.
(defn via-defn [] (java.util.ArrayList.))

;; `fn` IS OWNED BY THE FORM NAME — the analyzer publishes `fn -> …`, while the
;; CALLS attribution of the same form is the generated `lambda_<row>_<col>`, which is
;; a different question and a different answer.
(def via-fn (fn [] (java.util.HashMap.)))

;; A PROXY OR DEFTYPE METHOD IS A FUNCTION FORM, and owns its own body.
(def via-proxy (proxy [Runnable] []
                (run [] (java.util.concurrent.atomic.AtomicLong.))))

;; `def` CREATES A VAR, NOT A FUNCTION, so there is no active function and the
;; constructor is attributed to the NAMESPACE.
(def via-def (delay (java.io.StringReader. "x")))
