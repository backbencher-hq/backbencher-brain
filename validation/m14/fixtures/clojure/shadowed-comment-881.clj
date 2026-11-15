(ns shadow-boundary-probe)
(defn parameter-shadow [comment]
  (comment (live-argument))
  (after-parameter))
(defn local-shadow []
  (let [comment identity]
    (comment (live-local)))
  (after-local))
(defn still-quoted []
  '(shadow-quoted-ghost)
  (clojure.core/comment (shadow-qualified-ghost))
  (after-quoted))

;; ── W23-b (M49 W24): the shadow is REGIONAL and ORDER-AWARE ──
;; A1: no shadow is live yet — the macro still owns this form → DATA.
(comment (w23b-ordered-ghost))
(defn w23b-region-window []
  (let [comment identity]
    (comment (w23b-region-live)))
  ;; B: the let closed — outside the binding's region → DATA again.
  (comment (w23b-region-ghost))
  (w23b-region-after))
(defn w23b-multi
  ([comment] (comment (w23b-multi-live)))
  ([x] (comment (w23b-multi-ghost)) (w23b-multi-tail)))
;; ── W24-mr1: letfn fn-spec heads bind like binding-vector entries ──
;; C: the spec head `(comment [x] x)` shadows for the whole letfn form.
(defn w24-letfn-name []
  (letfn [(comment [x] x)]
    (comment (w24-letfn-name-live))))
;; D: a spec PARAM `[comment]` shadows inside its own spec.
(defn w24-letfn-param []
  (letfn [(f [comment] (comment (w24-letfn-param-live)))]
    (f identity)))
;; E: the name binding's region is the letfn form — after it, DATA again.
(defn w24-letfn-after []
  (letfn [(comment [x] x)]
    (comment (w24-letfn-after-live)))
  (comment (w24-letfn-after-ghost)))

;; A2: a def-family NAME binds the var at form end — shadowed from here on.
(def comment identity)
(defn w23b-after-def []
  (comment (w23b-defname-live)))
