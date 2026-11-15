def deploy(app, env) {
    echo "deploying ${app} to ${env}"
    sh "kubectl apply -f ${app}.yaml"
}

deploy("api", "staging")

// GAD2: mixed class + top-level statements in one script file
import groovy.json.JsonSlurper

class Deployer {
    def ship(app) {
        "shipping ${app}"
    }
}

def deployer = new Deployer()
deployer.ship("api")
new JsonSlurper().parseText('{}')
