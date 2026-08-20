---
name: lin-agent-layer
description: >-
  LIN semantic agent layer: index, query, deps, effects, diff, verify, compile,
  and repair for codebases. Use when the user asks to index a project, verify
  integrity, query symbols, check dependencies, track side effects, compile LIN
  modules, or repair errors.
---

# LIN Agent Layer

LIN provides a semantic cognitive layer for coding agents. It indexes code,
verifies integrity, queries symbols, and compiles LIN modules to any language.

## Core Operations

### 1. Build Index

```bash
node ~/.config/lin-agent-layer/cli.mjs index <workspace>
```

Creates a semantic index of all modules in the workspace.

### 2. Query Symbol

```bash
node ~/.config/lin-agent-layer/cli.mjs query <workspace> <symbol_name>
```

Finds all locations where a symbol is defined or used.

### 3. Dependencies

```bash
node ~/.config/lin-agent-layer/cli.mjs deps <workspace> <symbol_name>
```

Returns the dependency graph for a symbol.

### 4. Side Effects

```bash
node ~/.config/lin-agent-layer/cli.mjs effects <workspace> <symbol_name>
```

Lists all side effects produced by a symbol.

### 5. Diff

```bash
node ~/.config/lin-agent-layer/cli.mjs diff <workspace> <file_a> <file_b>
```

Semantic diff between two file versions.

### 6. Verify

```bash
node ~/.config/lin-agent-layer/cli.mjs verify <workspace>
```

Checks workspace integrity against the index.

### 7. Compile

```bash
node ~/.config/lin-agent-layer/cli.mjs compile <source.lin> <target>
```

Compiles a LIN module. Targets: ts, js, py, go, rust, c, java, zig, cs.

### 8. Classify Error

```bash
node ~/.config/lin-agent-layer/cli.mjs repair <error_text>
```

Classifies an error:
- **A**: Auto-repairable (repair engine can fix it)
- **B**: Needs diagnosis (requires analysis)
- **C**: Human required (security/policy/complex logic)

## Workflow

1. Run `index` once per project
2. Run `verify` after file edits to detect drift
3. Use `query`, `deps`, `effects` for code navigation
4. Use `compile` to emit target language code
5. Use `repair` to classify errors before attempting fixes

## Compilation Targets

| Target | Extension | Notes |
|--------|-----------|-------|
| ts     | .ts       | TypeScript (default) |
| js     | .js       | CommonJS JavaScript |
| py     | .py       | Python |
| go     | .go       | Go |
| rust   | .rs       | Rust |
| c      | .c        | C |
| java   | .java     | Java |
| zig    | .zig      | Zig |
| cs     | .cs       | C# |
