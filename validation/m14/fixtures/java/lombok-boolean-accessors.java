package proof;

import lombok.Data;

@Data
class Flags {
    private boolean ready;
    private boolean isActive;
    private Boolean boxed;
    private final boolean enabled = true;
}
