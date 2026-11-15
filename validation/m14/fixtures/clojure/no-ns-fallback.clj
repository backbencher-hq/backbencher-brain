;; CLJ-D34, half two — WITH NO NAMESPACE FORM, `user` IS A SYNTHETIC FALLBACK.
;;
;; This is the reason the skip existed at all: a file that declares nothing must
;; not claim a `user` namespace, and `user` is not a namespace this file
;; declared. So the guard belongs on the FALLBACK, never on the name, and these
;; two fixtures are the pair that says so: `in-ns-user` declares one and is
;; contained; this file does not and is not.
(defn undeclared-fn [x] (- x 1))
