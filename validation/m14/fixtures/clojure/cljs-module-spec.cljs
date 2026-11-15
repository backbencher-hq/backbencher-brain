;; CLJ-D58 — ClojureScript names a JavaScript module with a STRING.
;;
;; `(:require ["dayjs" :as dayjs])` puts a `str_lit` where every other libspec
;; puts a `sym_lit`, and the reader returned the node's text — so the alias
;; table, the `references` edge and (from CLJ-D53) the `imports` edge all
;; carried `"dayjs"` WITH ITS QUOTES. That is R10's `literal` class: the whole
;; target is a quoted string, and no language in this family declares such a
;; symbol. The shape is in clj-kondo's `corpus/shadow_cljs/dot_alias.cljs`,
;; three times on one ns form plus one top-level directive.
(ns clj-fixture.cljs-module-spec
  (:require ["dayjs" :as dayjs]
            ["dayjs/plugin/timezone" :as dayjs.timezone]
            ["dayjs/plugin/utc" :as dayjs.utc]))

(require '["dayjs/plugin/utc2" :as dayjs.utc2])

(defn today [] (dayjs))
(defn in-tz [] (dayjs.timezone))
(defn in-utc [] (dayjs.utc))
(defn in-utc2 [] (dayjs.utc2))