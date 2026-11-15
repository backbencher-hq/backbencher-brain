# Edit lane — external probe repository (preserved)

This directory preserves the five adversarial probe scripts from the edit lane's
separate private repository (`ishaq2321/bb_edit`): offset units, file fidelity,
rename ambiguity, untested modes and cross-language behaviour.

It is **evidence, not product code**: nothing in the build, the public tools, the
launch gate or the docs generator imports it. The lane's shipped findings and
evidence live in `validation/tools/bb_edit/`; these probes are kept for
reproducibility after the external repository is removed.
