;; A2 (2026-10-20): EVERY privacy spelling must bind private. The defect rows:
;; `defmulti ^{:private true}`, the LEGACY `#^{:private true}` wrapper (old_meta_lit) on a
;; macro and on a def, and `defn-` — five private declarations were exported as public.
(ns fixture.private-spellings)

(defmulti ^{:private true} hidden-multi :t)
(defn ^:private hidden-fn [] 1)
(defmacro #^{:private true} hidden-macro [] 1)
(def #^{:private true} hidden-var 1)

(defn public-fn [] 1)
