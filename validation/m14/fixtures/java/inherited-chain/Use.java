package chain;

/**
 * Level 3. `inherited()` is not declared here and not declared by the DIRECT parent
 * (Middle declares nothing); it is declared by Base, two levels up, in ANOTHER FILE.
 * A per-file walk over the file's own scopes cannot reach it — only the project's
 * ancestry can. An unresolved bare call would be dropped, so the presence of this
 * edge is the whole assertion.
 */
public class Use extends Middle {
    public void run() {
        inherited();
    }
}