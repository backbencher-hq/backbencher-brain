/**
 * The disambiguation TARGET. The project also declares `Filter` twice more, nested
 * inside ToolOwners, so the bare simple name is ambiguous project-wide
 * (`symbolCounts > 1`) and only this file's single-type import can decide which
 * declaration a reference in `Use.java` means.
 */
public class Filter {
    public void theImportedFilter() {
    }
}
