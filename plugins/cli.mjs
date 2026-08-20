#!/usr/bin/env node
/**
 * LIN Agent Layer — CLI Bridge
 *
 * Compiles each .lin file separately and executes via Function constructor.
 * Matches the approach used in plugin.mjs for OpenCode.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";

const HOME = process.env.HOME;
const LIN_SRC = join(HOME, "Downloads/lin-master/src");
const PROJECT_ROOT = join(HOME, "Documentos/Default Project");
const FILES = ["lin_core.lin", "lin_repair.lin", "lin_tools.lin"];

// ---------------------------------------------------------------------------
// LIN compilation (same approach as plugin.mjs)
// ---------------------------------------------------------------------------

let compileLia;
try {
  const multiEmit = await import(join(LIN_SRC, "multi_emit.mjs"));
  compileLia = multiEmit.compileLia;
} catch {
  throw new Error("lin-lang not found. Install lin-lang package.");
}

function compileLinFile(sourcePath) {
  const source = readFileSync(sourcePath, "utf-8");
  const result = compileLia(source, {
    target: "js",
    formalGate: false,
    skipRefineProof: true,
  });

  const mod = { exports: {} };
  const fn = new Function("module", "exports", result.code);
  fn(mod, mod.exports);
  return mod.exports;
}

// Compile all modules
const allExports = {};
for (const f of FILES) {
  const fullPath = join(PROJECT_ROOT, f);
  if (!existsSync(fullPath)) continue;
  const modExports = compileLinFile(fullPath);
  Object.assign(allExports, modExports);
}

// ---------------------------------------------------------------------------
// CLI commands
// ---------------------------------------------------------------------------

const [,, command, ...args] = process.argv;

try {
  switch (command) {
    case "index": {
      const workspace = args[0];
      if (!workspace) {
        console.error("Usage: cli.mjs index <workspace>");
        process.exit(1);
      }
      const result = allExports.mkIndex();
      console.log(JSON.stringify({ ok: true, workspace }));
      break;
    }

    case "query": {
      const [workspace, symbol] = args;
      if (!workspace || !symbol) {
        console.error("Usage: cli.mjs query <workspace> <symbol>");
        process.exit(1);
      }
      const result = allExports.indexQuerySymbol({}, symbol);
      console.log(JSON.stringify(result || []));
      break;
    }

    case "deps": {
      const [workspace, symbol] = args;
      if (!workspace || !symbol) {
        console.error("Usage: cli.mjs deps <workspace> <symbol>");
        process.exit(1);
      }
      const result = allExports.indexSymbolDependencies({}, symbol);
      console.log(JSON.stringify(result || []));
      break;
    }

    case "effects": {
      const [workspace, symbol] = args;
      if (!workspace || !symbol) {
        console.error("Usage: cli.mjs effects <workspace> <symbol>");
        process.exit(1);
      }
      const result = allExports.indexSymbolEffects({}, symbol);
      console.log(JSON.stringify(result || []));
      break;
    }

    case "diff": {
      const [workspace, fileA, fileB] = args;
      if (!workspace || !fileA || !fileB) {
        console.error("Usage: cli.mjs diff <workspace> <file_a> <file_b>");
        process.exit(1);
      }
      const result = allExports.diffB(fileA, fileB);
      console.log(JSON.stringify(result || {}));
      break;
    }

    case "verify": {
      const workspace = args[0];
      if (!workspace) {
        console.error("Usage: cli.mjs verify <workspace>");
        process.exit(1);
      }
      const idx = allExports.mkIndex();
      const result = allExports.verifyIdx(idx);
      console.log(JSON.stringify(result));
      break;
    }

    case "compile": {
      const [sourcePath, target] = args;
      if (!sourcePath) {
        console.error("Usage: cli.mjs compile <source.lin> [target]");
        process.exit(1);
      }
      const source = readFileSync(sourcePath, "utf-8");
      const result = compileLia(source, {
        target: target || "ts",
        formalGate: false,
        skipRefineProof: true,
      });
      console.log(JSON.stringify({ ok: true, target: target || "ts", code: result.code }));
      break;
    }

    case "repair": {
      const errorText = args.join(" ");
      if (!errorText) {
        console.error("Usage: cli.mjs repair <error_text>");
        process.exit(1);
      }
      const result = allExports.classifyError(errorText);
      console.log(JSON.stringify(result));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Commands: index, query, deps, effects, diff, verify, compile, repair");
      process.exit(1);
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
