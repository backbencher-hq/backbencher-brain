(ns com.example.clojure.service)

(defprotocol Formatter
  (format-value [this value]))

(defrecord ClojureService [prefix]
  Formatter
  (format-value [_ value] (str prefix ":" value)))

(defn create-service [prefix]
  (->ClojureService prefix))
