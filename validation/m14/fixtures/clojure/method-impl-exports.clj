;; A1 (2026-10-20): a METHOD IMPLEMENTATION is not a namespace-level definition and must
;; never appear in the namespace's export surface. The defect rows: `defmethod` impls
;; (symbol metadata isMethodImpl) and record/type/proxy/reify method impls
;; (isProtocolMethodImpl) were exported (29 rows at whole population).
(ns fixture.method-impl-exports)

(defmethod print-method :fixture-tag [x ^java.io.Writer w]
  (.write w "tagged"))

(proxy [Object] []
  (toString [] "fixture"))

(defrecord Box [width])

(defmulti render :type)
(defmethod render :a [x] x)

(defn impl-target [] 1)
