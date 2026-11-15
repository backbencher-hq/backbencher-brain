;; CLJ-D31 — `in-ns` IS A NAMESPACE FORM.
;;
;; `(in-ns 'a.b)` is how a file loaded into a running runtime declares its
;; namespace. `currentNamespace` stayed "user" for it, so every top-level
;; definition in such a file was stranded on owner `user` with NO `contains`
;; edge and the wrong scope: 484 definitions across 17 files, the whole of
;; clojure's own pretty-printer (cl_format, pprint_base, dispatch,
;; pretty_writer, core_print, genclass, core_deftype) among them.
;;
;; It was invisible for three waves because it is an ABSENCE, not a wrong value:
;; a file whose namespace is unknown still emits a full, plausible symbol table,
;; and every per-class completeness claim was true of it.
(in-ns 'clj.fixture.inns)

(defn in-ns-fn [x] (+ x 1))

;; A SECOND namespace switch in one file. The definitions after it belong to the
;; namespace in force HERE, not to the one the file opened with.
(in-ns 'clj.fixture.inns.second)

(defn second-ns-fn [x] (* x 2))
