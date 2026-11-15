(ns app.handler
  (:require [ring.adapter.jetty :as jetty]
            [compojure.core :refer [defroutes GET]]))

(defroutes app
  (GET "/" [] "hi"))

(defn -main []
  (jetty/run-jetty app {:port 3000}))
