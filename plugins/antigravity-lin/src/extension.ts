/**
 * LIN Agent Layer — VS Code / Antigravity IDE Extension
 *
 * Provides 7 commands and auto-verify hook for LIN semantic operations.
 * Compiles LIN → JS via linobj at activation time.
 */

import * as vscode from "vscode";
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";

const LIN_SRC_DEFAULT =
  process.env.HOME + "/Downloads/lin-master/src";

let linExports: Record<string, Function> | null = null;
let workspaceIndex: any = null;

// ---------------------------------------------------------------------------
// LIN compilation via Node subprocess
// ---------------------------------------------------------------------------

function getLinSrc(): string {
  const config = vscode.workspace.getConfiguration("lin");
  const custom = config.get<string>("linSrcPath");
  if (custom && existsSync(custom)) return custom;
  if (existsSync(LIN_SRC_DEFAULT)) return LIN_SRC_DEFAULT;
  throw new Error("lin-master/src not found. Set lin.linSrcPath in settings.");
}

function compileLinCombined(): Record<string, Function> {
  const linSrc = getLinSrc();
  const root = join(dirname(__filename), "..", "..", "..");
  const files = ["lin_core.lin", "lin_repair.lin", "lin_tools.lin"];
  const sources = files.map((f) => {
    const path = join(root, f);
    if (existsSync(path)) return readFileSync(path, "utf-8");
    return "";
  });

  const combined = sources.filter(Boolean).join("\n");
  const script = `
import { compileLia } from '${linSrc}/multi_emit.mjs';
const result = compileLia(${JSON.stringify(combined)}, {
  target: 'js', formalGate: false, skipRefineProof: true
});
process.stdout.write(result.code);
`;
  const tmpFile = join(linSrc, ".tmp_lin_compile.mjs");
  require("fs").writeFileSync(tmpFile, script);

  try {
    const jsCode = execSync(`node ${tmpFile}`, { timeout: 10000 }).toString();
    // Execute the compiled JS to get exports
    const execScript = `
const exports = {};
${jsCode}
const result = JSON.stringify(Object.keys(exports));
process.stdout.write(result);
`;
    const execFile = join(linSrc, ".tmp_lin_exec.mjs");
    require("fs").writeFileSync(execFile, execScript);
    try {
      execSync(`node ${execFile}`, { timeout: 10000 });
    } finally {
      require("fs").unlinkSync(execFile);
    }
    // Return a proxy object
    return createLinProxy(jsCode);
  } finally {
    require("fs").unlinkSync(tmpFile);
  }
}

function createLinProxy(jsCode: string): Record<string, Function> {
  // Execute all at once and capture exports
  const tmpFile = join(getLinSrc(), ".tmp_lin_all.mjs");
  const execCode = `
const exports = {};
${jsCode}
const fns = {};
for (const [k, v] of Object.entries(exports)) {
  if (typeof v === 'function') fns[k] = true;
}
process.stdout.write(JSON.stringify({ functions: Object.keys(fns) }));
`;
  require("fs").writeFileSync(tmpFile, execCode);
  try {
    const output = execSync(`node ${tmpFile}`, { timeout: 10000 }).toString();
    const { functions } = JSON.parse(output);

    const proxy: Record<string, Function> = {};
    for (const name of functions) {
      proxy[name] = (...args: any[]) => {
        const callFile = join(getLinSrc(), `.tmp_lin_call_${name}.mjs`);
        const callCode = `
const exports = {};
${jsCode}
const result = exports.${name}(${args.map((a) => JSON.stringify(a)).join(",")});
process.stdout.write(JSON.stringify(result));
`;
        require("fs").writeFileSync(callFile, callCode);
        try {
          const out = execSync(`node ${callFile}`, { timeout: 10000 }).toString();
          return JSON.parse(out);
        } finally {
          require("fs").unlinkSync(callFile);
        }
      };
    }
    return proxy;
  } finally {
    require("fs").unlinkSync(tmpFile);
  }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  // Compile LIN modules at activation
  try {
    linExports = compileLinCombined();
    vscode.window.showInformationMessage(
      `[LIN] Agent Layer activated — ${Object.keys(linExports).length} functions loaded`
    );
  } catch (e: any) {
    vscode.window.showErrorMessage(`[LIN] Failed to compile: ${e.message}`);
    return;
  }

  // Command: Build Index
  context.subscriptions.push(
    vscode.commands.registerCommand("lin.index", async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders) {
        vscode.window.showWarningMessage("No workspace open");
        return;
      }
      const root = folders[0].uri.fsPath;
      workspaceIndex = linExports?.mkIndex?.() || { modules: {} };
      vscode.window.showInformationMessage(
        `[LIN] Index built for ${root}`
      );
    })
  );

  // Command: Verify
  context.subscriptions.push(
    vscode.commands.registerCommand("lin.verify", async () => {
      if (!workspaceIndex) {
        vscode.window.showWarningMessage("No index. Run LIN: Build Semantic Index first.");
        return;
      }
      const result = linExports?.verifyIdx?.(workspaceIndex);
      if (result?.ok) {
        vscode.window.showInformationMessage("[LIN] Workspace integrity OK");
      } else {
        vscode.window.showWarningMessage(
          `[LIN] Drift detected: ${result?.drift?.length || 0} modules changed`
        );
      }
    })
  );

  // Command: Query Symbol
  context.subscriptions.push(
    vscode.commands.registerCommand("lin.query", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Symbol name to query",
        placeHolder: "e.g. calculateTotal",
      });
      if (!name) return;

      if (!workspaceIndex) {
        vscode.window.showWarningMessage("No index. Build index first.");
        return;
      }
      const result = linExports?.indexQuerySymbol?.(workspaceIndex, name);
      if (result) {
        vscode.window.showInformationMessage(
          `[LIN] Found ${name} in ${result.length} location(s)`
        );
      } else {
        vscode.window.showInformationMessage(`[LIN] Symbol "${name}" not found`);
      }
    })
  );

  // Command: Compile
  context.subscriptions.push(
    vscode.commands.registerCommand("lin.compile", async () => {
      const target = await vscode.window.showQuickPick(
        ["ts", "js", "py", "go", "rust", "c", "java", "zig", "cs"],
        { placeHolder: "Select compilation target" }
      );
      if (!target) return;

      const modulePath = await vscode.window.showInputBox({
        prompt: "Module path (relative to workspace)",
        placeHolder: "e.g. auth.lin",
      });
      if (!modulePath) return;

      vscode.window.showInformationMessage(
        `[LIN] Compile ${modulePath} → ${target}`
      );
    })
  );

  // Command: Classify Error
  context.subscriptions.push(
    vscode.commands.registerCommand("lin.repair", async () => {
      const error = await vscode.window.showInputBox({
        prompt: "Error text to classify",
        placeHolder: "e.g. SyntaxError: Unexpected token",
      });
      if (!error) return;

      const result = linExports?.classifyError?.(error) || { cls: "B", reason: "unknown" };
      const labels: Record<string, string> = {
        A: "Auto-repairable",
        B: "Needs diagnosis",
        C: "Human required",
      };
      vscode.window.showInformationMessage(
        `[LIN] Class ${result.cls}: ${labels[result.cls] || result.reason}`
      );
    })
  );

  // Auto-verify on file save
  const config = vscode.workspace.getConfiguration("lin");
  if (config.get<boolean>("autoVerify")) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (
          doc.fileName.endsWith(".ts") ||
          doc.fileName.endsWith(".js") ||
          doc.fileName.endsWith(".lin")
        ) {
          if (workspaceIndex) {
            const result = linExports?.verifyIdx?.(workspaceIndex);
            if (!result?.ok) {
              vscode.window.showWarningMessage(
                `[LIN] Drift after save: ${doc.fileName}`
              );
            }
          }
        }
      })
    );
  }
}

export function deactivate() {}
