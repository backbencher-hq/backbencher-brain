package app;

import androidx.media3.common.C;
import jakarta.servlet.Filter;

/**
 * POSITIVE half of the library-namespace citation fixture, now runnable because the fixture
 * runner gives java SUB-DIRECTORY fixtures a real project index (`JAVA_DECLARATION_SPEC`,
 * `complete = true`): the project does NOT declare these FQNs, so each single-type import
 * under a registry root licenses a citation — the dotted module path a PREFIX citation
 * (`["jakarta"]` / `["androidx"]`), the bare name a BARE-SYMBOL citation (`["Filter"]`,
 * namespaceMatchOf's bare-symbol form, sound only because the import's root is in the registry).
 */
public class ExternalUse {
  Filter filter;
  int index = C.INDEX;
}
