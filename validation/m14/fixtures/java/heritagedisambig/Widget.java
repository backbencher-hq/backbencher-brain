/**
 * The disambiguation TARGET for heritage and construction. The project also declares
 * `Widget` twice more, nested inside Owners, so the bare simple name is ambiguous
 * project-wide and only an explicit import can decide which one a subclass or a `new`
 * means.
 */
public class Widget {
    public void baseWidget() {
    }
}
