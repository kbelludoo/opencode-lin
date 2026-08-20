/**
 * plugin.mjs — OpenCode LIN Agent Layer
 *
 * Compiles LIN source → TS via linobj at load time.
 * Registers 7 tools with OpenCode's plugin API.
 *
 * Architecture:
 *   .lin files → compileLia({target:'ts'}) → executed functions
 *   → exposed as OpenCode tools via plugin
 *
 * Hook names (from OpenCode API):
 *   - session.created / session.deleted / session.idle / session.error
 *   - tool.execute.before / tool.execute.after
 *   - event (generic event handler)
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// LIN → TS compilation via multi_emit
// ---------------------------------------------------------------------------

const LIN_SRC = "/home/k/Downloads/lin-master/src";

let compileLia, buildLinobj;
try {
  const multiEmit = await import(join(LIN_SRC, "multi_emit.mjs"));
  compileLia = multiEmit.compileLia;
  const linobjMod = await import(join(LIN_SRC, "linobj.mjs"));
  buildLinobj = linobjMod.buildLinobj;
} catch {
  throw new Error(
    "opencode-lin: linobj not found. Ensure lin-lang is installed at " + LIN_SRC
  );
}

/**
 * Compile a .lin file to executable JS.
 * Uses JS as target (clean CommonJS output with module.exports).
 */
function compileLinFile(relPath) {
  const fullPath = join(__dirname, relPath);
  const source = readFileSync(fullPath, "utf-8");

  const result = compileLia(source, {
    target: "js",
    formalGate: false,
    skipRefineProof: true,
  });

  // JS target already has module.exports — execute directly
  const exports = {};
  const mod = { exports };
  const fn = new Function("module", "exports", result.code);
  fn(mod, exports);

  return mod.exports;
}

// ---------------------------------------------------------------------------
// Compile all LIN modules
// ---------------------------------------------------------------------------

const linCore = compileLinFile("lin_core.lin");
const linRepair = compileLinFile("lin_repair.lin");
const linTools = compileLinFile("lin_tools.lin");

// ---------------------------------------------------------------------------
// Plugin state
// ---------------------------------------------------------------------------

/** @type {Object | null} */
let workspaceIndex = null;

// ---------------------------------------------------------------------------
// Tool definitions for OpenCode
// ---------------------------------------------------------------------------

const tools = [
  {
    name: "lin_index",
    description:
      "Build/rebuild the LIN semantic index for the workspace. " +
      "Returns module count, symbol count, effect count.",
    parameters: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Workspace root path (defaults to cwd)",
        },
      },
    },
    async execute({ workspace }) {
      const root = workspace || process.cwd();
      workspaceIndex = linCore.mkIndex();
      const stats = linCore.stats(workspaceIndex);
      return { status: "indexed", workspace: root, ...stats };
    },
  },

  {
    name: "lin_query",
    description:
      "Query a symbol by name in the LIN semantic index. " +
      "Returns kind, module, dependencies, effects.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Symbol name to look up" },
      },
      required: ["name"],
    },
    async execute({ name }) {
      if (!workspaceIndex) {
        return { status: "error", message: "Index not built. Run lin_index first." };
      }
      const result = linCore.indexQuerySymbol(workspaceIndex, name);
      if (!result) return { status: "not_found", name };
      return { status: "found", name, occurrences: result };
    },
  },

  {
    name: "lin_verify",
    description:
      "Verify workspace integrity. Detects modules that changed since " +
      "last lin_index (semantic hash drift).",
    parameters: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Workspace root path (defaults to cwd)",
        },
      },
    },
    async execute({ workspace }) {
      if (!workspaceIndex) {
        return { status: "error", message: "Index not built. Run lin_index first." };
      }
      const result = linCore.verifyIdx(workspaceIndex);
      return { tool: "lin_verify", workspace: workspace || process.cwd(), ...result };
    },
  },

  {
    name: "lin_compile",
    description:
      "Compile/type-check a module for a specific target. " +
      "Default target: ts. Also supports: js, py, go, rust, c, java, zig, cs.",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Compilation target (ts|js|py|go|rust|c|java|zig|cs)",
          default: "ts",
        },
        module: {
          type: "string",
          description: "Module path (relative to workspace)",
        },
      },
      required: ["module"],
    },
    async execute({ target, module: mod }) {
      if (!workspaceIndex) {
        return { status: "error", message: "Index not built. Run lin_index first." };
      }
      const result = linCore.compileTarget(target || "ts", mod, workspaceIndex);
      return { tool: "lin_compile", ...result };
    },
  },

  {
    name: "lin_repair",
    description:
      "Classify an error and attempt auto-repair. " +
      "Class A = auto-repairable (syntax, import, type). " +
      "Class B = needs diagnosis (runtime, test). " +
      "Class C = architectural (human required). " +
      "Also detects compiler bugs for self-repair.",
    parameters: {
      type: "object",
      properties: {
        error: { type: "string", description: "Error text to classify" },
        source: { type: "string", description: "Source code context" },
        stage: {
          type: "string",
          description: "Compilation stage (parse|type|runtime|test)",
          default: "parse",
        },
      },
      required: ["error"],
    },
    async execute({ error, source, stage }) {
      const result = linRepair.repair(error, source, stage, null);
      return { tool: "lin_repair", ...result };
    },
  },

  {
    name: "lin_diff",
    description:
      "Semantic diff between two source strings. " +
      "Detects added/removed/changed symbols.",
    parameters: {
      type: "object",
      properties: {
        oldSource: { type: "string", description: "Old source code" },
        newSource: { type: "string", description: "New source code" },
        oldPath: { type: "string", description: "Old file path (optional)" },
        newPath: { type: "string", description: "New file path (optional)" },
      },
      required: ["oldSource", "newSource"],
    },
    async execute({ oldSource, newSource, oldPath, newPath }) {
      const result = linCore.semanticDiff(oldSource, newSource, oldPath, newPath);
      return { tool: "lin_diff", ...result };
    },
  },

  {
    name: "lin_fix_compiler",
    description:
      "Report a LIN compiler bug. Reproduces, minimizes, generates patch. " +
      "Only for errors classified as compiler bugs by lin_repair.",
    parameters: {
      type: "object",
      properties: {
        error: { type: "string", description: "Compiler error text" },
        source: { type: "string", description: "Source that triggered the error" },
        stage: { type: "string", description: "Stage where error occurred" },
      },
      required: ["error"],
    },
    async execute({ error, source, stage }) {
      const isBug = linRepair.isCompilerBug(error);
      if (!isBug) {
        return {
          tool: "lin_fix_compiler",
          status: "rejected",
          reason: "not_compiler_bug",
          message: "Error does not match compiler bug patterns",
        };
      }
      const repro = linRepair.reproKey(error, source, stage);
      const mini = linRepair.minimizeCase(repro);
      const patch = linRepair.genPatch(mini, null);
      const reg = linRepair.needsRegression(patch);
      return {
        tool: "lin_fix_compiler",
        status: "patch_ready",
        repro,
        minimized: mini,
        patch,
        requiresRegression: reg,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// OpenCode Plugin Export (correct API shape)
// ---------------------------------------------------------------------------

/**
 * OpenCode plugin export.
 *
 * @param {Object} ctx - Plugin context from OpenCode
 * @returns {Object} Plugin hooks and tools
 */
export default async function opencodeLinPlugin(ctx = {}) {
  return {
    name: "opencode-lin",
    version: "0.1.0",

    tools: () => tools,

    event: async ({ event }) => {
      if (event.type === "session.created") {
        const root = process.cwd();
        workspaceIndex = linCore.mkIndex();
        const stats = linCore.stats(workspaceIndex);
        console.log(
          `[opencode-lin] Index built: ${stats.modules} modules, ${stats.symbols} symbols, ${stats.effects} effects`
        );
      }
    },

    "tool.execute.after": async (input) => {
      if (input.tool === "write" || input.tool === "edit") {
        if (workspaceIndex) {
          const vfy = linCore.verifyIdx(workspaceIndex);
          if (!vfy.ok) {
            console.log(
              `[opencode-lin] Drift detected: ${vfy.drift.length} modules changed`
            );
          }
        }
      }
    },

    stop: async () => {
      workspaceIndex = null;
    },
  };
}
