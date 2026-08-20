#!/usr/bin/env node
/**
 * LIN Verify Hook — Antigravity PostToolUse
 *
 * Receives hook context on stdin, runs verify, outputs result.
 */

import { readFileSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";

const __filename = import.meta.url.replace("file://", "");
const __dirname = dirname(__filename);
const HOME = process.env.HOME;
const LIN_SRC = join(HOME, "Downloads/lin-master/src");
const CLI_PATH = join(__dirname, "cli.mjs");

// Read stdin
let input = "";
process.stdin.setEncoding("utf-8");
for await (const chunk of process.stdin) {
  input += chunk;
}

try {
  const payload = JSON.parse(input);
  const workspace = payload.workspacePaths?.[0];
  if (!workspace) {
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  }

  // Run verify
  const result = execSync(`node ${CLI_PATH} verify "${workspace}"`, {
    timeout: 10000,
    encoding: "utf-8",
  });

  const data = JSON.parse(result);
  if (!data.ok) {
    process.stdout.write(JSON.stringify({
      injectSteps: [
        {
          ephemeralMessage: `[LIN] Drift detected: ${data.drift?.length || 0} modules changed. Run LIN verify to see details.`
        }
      ]
    }));
  } else {
    process.stdout.write(JSON.stringify({}));
  }
} catch (e) {
  process.stdout.write(JSON.stringify({}));
}
