// PINS framework detection (M49 #741, CONV-S-1): scala was the only JVM
// language blind to Spring — java emitted "spring", kotlin "Spring Boot" /
// "Spring Framework", groovy "spring", scala nothing. Framework payload is
// consumer-visible metadata and is differential-invisible (the oracle derives
// no framework truth), so it MUST be fixture-gated, exactly as the go
// framework-detection fixture records for the same reason.
//
// Detection is ROOT-PREFIX only (S1.23 contract), so this fixture pins BOTH
// directions: the five ecosystems below must be detected, and the three
// user-code imports at the bottom — which CONTAIN framework roots as
// substrings — must not produce anything. Without the forbid direction, a
// detector that switched to substring matching would still pass every
// positive assertion.
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.stereotype.Service
import com.fasterxml.jackson.databind.ObjectMapper
import com.github.plokhotnyuk.jsoniter_scala.core.JsonValueCodec
import com.softwaremill.sttp.client3.HttpClient

// Negative controls: user code whose module path merely CONTAINS a framework
// root. None of these is a framework import.
import com.mycompany.springframework.internal.Thing
import mycats.Custom
import org.springlike.other.Widget

class App
