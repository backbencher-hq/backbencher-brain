// fixture: java/annotation-column-lines
// M59 (#825) follow-up, measured on grails-core Item.java: a mapped_column's
// line_number is where the column's NAME is written — the string literal when
// the name is explicit (`@Column(name = "user_name")`), the field's declaration
// line when the target is implicit (`@Column` alone, target = field name).
// Before this pin an implicit `@Column` claimed the annotation's own line, where
// the column name is written nowhere — the same decorator-line defect class the
// web analyizers carry (#860/#861) and python still does (#861 family).
package lines;

import java.time.Instant;
import jakarta.persistence.Column;

class Items {
  @Column
  private Instant timestamp1;

  @Column(name = "user_name")
  private String user;
}
