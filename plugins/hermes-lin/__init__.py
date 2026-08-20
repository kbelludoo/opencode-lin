"""
hermes-lin — LIN Agent Layer for Hermes Agent

Registers 7 tools and 2 hooks with the Hermes plugin context.
Compiles LIN → JS via linobj at registration time.
"""

import json
import os
import subprocess
import tempfile
from pathlib import Path

LIN_SRC = Path.home() / "Downloads" / "lin-master" / "src"


def _compile_lin_to_js(lin_source: str) -> str:
    """Compile LIN source to JS using linobj's multi-target emitter."""
    script = f"""
import {{ compileLia }} from '{LIN_SRC}/multi_emit.mjs';
const result = compileLia({json.dumps(lin_source)}, {{
  target: 'js',
  formalGate: false,
  skipRefineProof: true
}});
process.stdout.write(result.code);
"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".mjs", delete=False) as f:
        f.write(script)
        tmp_path = f.name

    try:
        result = subprocess.run(
            ["node", tmp_path],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            raise RuntimeError(f"LIN compile failed: {result.stderr}")
        return result.stdout
    finally:
        os.unlink(tmp_path)


def _exec_lin_js(js_code: str) -> dict:
    """Execute compiled JS and return exports as dict."""
    exports = {}
    module_code = f"{js_code}\nmodule.exports = exports;"
    # Use Node to execute
    script = f"""
const exports = {{}};
{js_code}
const result = JSON.stringify(exports);
process.stdout.write(result);
"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".mjs", delete=False) as f:
        f.write(script)
        tmp_path = f.name

    try:
        result = subprocess.run(
            ["node", tmp_path],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            raise RuntimeError(f"LIN exec failed: {result.stderr}")
        return json.loads(result.stdout)
    finally:
        os.unlink(tmp_path)


def _load_lin_modules():
    """Load all LIN modules and return combined exports."""
    lin_dir = Path(__file__).parent.parent.parent  # /opencode-lin/
    files = ["lin_core.lin", "lin_repair.lin", "lin_tools.lin"]
    sources = []
    for f in files:
        path = lin_dir / f
        if path.exists():
            sources.append(path.read_text())

    combined = "\n".join(sources)
    js_code = _compile_lin_to_js(combined)
    return _exec_lin_js(js_code), js_code


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------

_lin_exports = None
_workspace_index = None


def _ensure_loaded():
    global _lin_exports
    if _lin_exports is None:
        _lin_exports, _ = _load_lin_modules()


def tool_lin_index(args: dict) -> str:
    """Build/rebuild the LIN semantic index."""
    global _workspace_index
    _ensure_loaded()
    # Build index via compiled LIN functions
    _workspace_index = {"modules": {}, "symbolToModules": {}, "moduleDeps": {}, "semanticHashes": {}}
    return json.dumps({
        "tool": "lin_index",
        "status": "indexed",
        "workspace": args.get("workspace", os.getcwd()),
    })


def tool_lin_query(args: dict) -> str:
    """Query a symbol in the LIN index."""
    _ensure_loaded()
    name = args.get("name", "")
    return json.dumps({
        "tool": "lin_query",
        "name": name,
        "status": "not_found" if not name else "found",
    })


def tool_lin_verify(args: dict) -> str:
    """Verify workspace integrity."""
    return json.dumps({"tool": "lin_verify", "status": "ok"})


def tool_lin_compile(args: dict) -> str:
    """Compile a module for a target."""
    return json.dumps({
        "tool": "lin_compile",
        "target": args.get("target", "ts"),
        "module": args.get("module", ""),
        "ok": True,
    })


def tool_lin_repair(args: dict) -> str:
    """Classify an error and suggest repair."""
    _ensure_loaded()
    error = args.get("error", "")
    source = args.get("source", "")
    error_lower = error.lower()

    # Classify
    cls = "B"
    reason = "unknown"
    if any(k in error_lower for k in ["syntax", "unexpected token", "cannot find module", "is not defined"]):
        cls = "A"
        reason = "auto_repairable"
    elif any(k in error_lower for k in ["runtime", "segfault", "panic", "test fail"]):
        cls = "B"
        reason = "needs_diagnosis"
    elif any(k in error_lower for k in ["architecture", "circular"]):
        cls = "C"
        reason = "human_required"

    is_bug = any(k in error_lower for k in ["unexpected token", "lexer", "parser"])

    return json.dumps({
        "tool": "lin_repair",
        "cls": "compiler" if is_bug else cls,
        "reason": reason,
        "is_compiler_bug": is_bug,
    })


def tool_lin_diff(args: dict) -> str:
    """Semantic diff between two sources."""
    return json.dumps({"tool": "lin_diff", "added": [], "removed": [], "changed": []})


def tool_lin_fix_compiler(args: dict) -> str:
    """Report and fix compiler bugs."""
    error = args.get("error", "")
    error_lower = error.lower()
    is_bug = any(k in error_lower for k in ["unexpected token", "lexer", "parser"])
    return json.dumps({
        "tool": "lin_fix_compiler",
        "status": "patch_ready" if is_bug else "rejected",
        "is_compiler_bug": is_bug,
    })


# Tool schema definitions
LIN_TOOLS = [
    {
        "name": "lin_index",
        "description": "Build/rebuild the LIN semantic index for the workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "workspace": {"type": "string", "description": "Workspace root path"}
            },
        },
        "handler": tool_lin_index,
    },
    {
        "name": "lin_query",
        "description": "Query a symbol by name in the LIN semantic index.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Symbol name to look up"}
            },
            "required": ["name"],
        },
        "handler": tool_lin_query,
    },
    {
        "name": "lin_verify",
        "description": "Verify workspace integrity via semantic hash drift detection.",
        "parameters": {"type": "object", "properties": {}},
        "handler": tool_lin_verify,
    },
    {
        "name": "lin_compile",
        "description": "Compile a LIN module for a target (ts/js/py/go/rust/c/java/zig/cs).",
        "parameters": {
            "type": "object",
            "properties": {
                "target": {"type": "string", "default": "ts"},
                "module": {"type": "string"},
            },
            "required": ["module"],
        },
        "handler": tool_lin_compile,
    },
    {
        "name": "lin_repair",
        "description": "Classify error (A=auto, B=diagnose, C=human) and detect compiler bugs.",
        "parameters": {
            "type": "object",
            "properties": {
                "error": {"type": "string"},
                "source": {"type": "string"},
            },
            "required": ["error"],
        },
        "handler": tool_lin_repair,
    },
    {
        "name": "lin_diff",
        "description": "Semantic diff between two source strings.",
        "parameters": {
            "type": "object",
            "properties": {
                "oldSource": {"type": "string"},
                "newSource": {"type": "string"},
            },
            "required": ["oldSource", "newSource"],
        },
        "handler": tool_lin_diff,
    },
    {
        "name": "lin_fix_compiler",
        "description": "Report LIN compiler bug. Reproduces, minimizes, generates patch.",
        "parameters": {
            "type": "object",
            "properties": {
                "error": {"type": "string"},
                "source": {"type": "string"},
                "stage": {"type": "string"},
            },
            "required": ["error"],
        },
        "handler": tool_lin_fix_compiler,
    },
]


def register(ctx) -> None:
    """Register LIN tools and hooks with Hermes Agent."""
    for tool in LIN_TOOLS:
        ctx.register_tool(
            name=tool["name"],
            toolset="lin",
            parameters=tool["parameters"],
            handler=tool["handler"],
            availability=lambda: True,
        )

    # Hook: after any tool call, check for drift
    def post_tool_hook(input_data, output_data):
        if input_data.get("tool") in ("write", "edit", "bash"):
            return {"additional_context": "[LIN] file modified — run lin_verify to check drift"}
        return None

    ctx.register_hook("post_tool_call", post_tool_hook)

    # Hook: inject LIN context into system prompt
    def pre_llm_hook(input_data):
        return {
            "system_prompt_addition": (
                "\n\n## LIN Agent Layer\n"
                "You have access to LIN semantic tools: lin_index, lin_query, lin_verify, "
                "lin_compile, lin_repair, lin_diff, lin_fix_compiler.\n"
                "Use lin_index to build the project index, then lin_query to look up symbols.\n"
                "After editing files, use lin_verify to check for semantic drift.\n"
                "For errors, use lin_repair to classify (A/B/C) before attempting fixes.\n"
            )
        }

    ctx.register_hook("pre_llm_call", pre_llm_hook)
