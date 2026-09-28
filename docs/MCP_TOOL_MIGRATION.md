# MCP Tool Migration Guide

Version `0.2.x` advertised the ten-tool public surface while retaining legacy
tool names as callable compatibility aliases. Version `0.3.0` removed those
aliases as announced. The table below is retained as historical migration guidance;
the legacy names now return `unknown tool`.

| Legacy tool | Replacement | Mode |
| --- | --- | --- |
| `bb_select` | `bb_search` | `symbol` |
| `bb_relationships` | `bb_analyze` | `callers`, `callees`, or `trace` |
| `bb_refresh` | `bb_health` | `refresh` |
| `bb_write` | `bb_edit` | `write` |
| `bb_update` | `bb_edit` | `update` |
| `bb_insert` | `bb_edit` | `insert` |
| `bb_delete` | `bb_edit` | `delete` |
| `bb_refactor` | `bb_edit` | `refactor` |
| `bb_test_quality` | `bb_analyze` | `test_quality` |
| `bb_test_suggestions` | `bb_analyze` | `test_impact` |

## Public Tools

`bb_search`, `bb_ask`, `bb_analyze`, `bb_patterns`, `bb_security`, `bb_doc`,
`bb_visualize`, `bb_migrate`, `bb_edit`, and `bb_health` are the complete public
MCP discovery surface.

## Validation

Every tool rejects options that are not declared in its input schema. Composite
tools additionally validate mode requirements. This prevents misspelled or
irrelevant options from being silently ignored.

## CLI

Existing ergonomic commands remain available. Every public tool can also be
invoked through the shared CLI gateway:

```text
bb tool bb_doc --dir . --args '{"mode":"symbol","target":"handleRequest"}'
bb tool bb_analyze --args '{"mode":"stats"}'
```

The gateway uses the same registry and handlers as MCP, including option
validation and output behavior.
