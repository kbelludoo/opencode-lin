# LIN Agent Layer Rules

When working with LIN modules:

- Always run `verify` after editing `.lin` files to detect drift
- Use `repair` to classify errors before attempting manual fixes
- Use `query` and `deps` to understand code before modifying it
- Prefer `compile` with target `js` for runtime execution
- Default compilation target is `ts` unless otherwise specified
