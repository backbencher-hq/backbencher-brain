// #841 round 10 — Groovy's MULTIPLE-ASSIGNMENT declaration.
//
// `def (a, b) = expr` declares several locals from one expression. The grammar
// had no such form, so the line was an ERROR and recovery took the enclosing
// class with it. Every corpus file carrying the form uses `def` with it:
//
//   ManyToOneBinderSpec.groovy            def (mapping, refDomainClass) = mockEntity(id)
//   SimpleMapQuery.groovy                 def (embeddedProperty, nestedProperty) = propertyName.tokenize('.')
//   TransactionalTransformSpec.groovy     def (parent, child) = new GroovyShell().evaluate('''…''')
//   GrailsShadowLicenseTransform.groovy   def (grailsLicense, grailsIndexMappings) = normalize(text)
//   CreateAppCommandSpec.groovy           def (previewFeature, communityFeature) = beanContext.getBean(…)
//   AbstractS2UiDomainController.groovy   def (int max, int offset) = maxAndOffset()
//
// That last one is why the declarator is `optional(type) name` rather than a
// bare identifier — visible in the typed case below.
class MultipleAssignment841 {

    def fromExpression(beanContext) {
        def (first, second) = beanContext.getBean(WebAvailableFeatures)
        return first
    }

    def typedDeclarators() {
        def (int max, int offset) = maxAndOffset()
        return max
    }
}
