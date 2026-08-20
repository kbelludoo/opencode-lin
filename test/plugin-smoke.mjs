/**
 * plugin-smoke.mjs — Smoke test for opencode-lin plugin
 *
 * Validates:
 *   1. LIN files parse correctly via linobj
 *   2. Compiled functions are callable
 *   3. Core operations work (index, query, verify, diff, repair)
 *   4. Tool definitions are well-formed
 *
 * Run: node test/plugin-smoke.mjs
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Load linobj + compileLia from lin-lang
// ---------------------------------------------------------------------------

const LIN_SRC = "/home/k/Downloads/lin-master/src";

let compileLia, buildLinobj;
try {
  const multiEmit = await import(join(LIN_SRC, "multi_emit.mjs"));
  compileLia = multiEmit.compileLia;
  const linobjMod = await import(join(LIN_SRC, "linobj.mjs"));
  buildLinobj = linobjMod.buildLinobj;
  console.log(`\nlinobj loaded: v${linobjMod.LINOBJ_FORMAT_VERSION || "?"}`);
  console.log(`compileLia available: ${typeof compileLia === "function"}`);
} catch (e) {
  console.error("\nlinobj/compileLia not found at", LIN_SRC);
  console.error(e.message);
  console.log("Running syntax validation only...\n");
}

// ---------------------------------------------------------------------------
// Test 1: LIN files exist and are non-empty
// ---------------------------------------------------------------------------

console.log("\n1. File existence");

const linFiles = ["lin_core.lin", "lin_repair.lin", "lin_tools.lin"];
for (const f of linFiles) {
  const path = join(ROOT, f);
  try {
    const content = readFileSync(path, "utf-8");
    assert(`${f} exists`, content.length > 100);
    assert(`${f} has @LIN header`, content.startsWith("@LIN:"));
    assert(`${f} has export line`, content.indexOf("=") >= 0 && (content.indexOf("=ex{") >= 0 || content.match(/^=\w/m)));
  } catch (e) {
    assert(`${f} exists`, false, e.message);
  }
}

// ---------------------------------------------------------------------------
// Test 2: LIN compilation via compileLia
// ---------------------------------------------------------------------------

if (compileLia) {
  console.log("\n2. LIN → TS compilation");

  for (const f of linFiles) {
    const path = join(ROOT, f);
    const source = readFileSync(path, "utf-8");
    try {
      const result = compileLia(source, {
        target: "ts",
        formalGate: false,
        skipRefineProof: true,
      });
      assert(`${f} compiles to TS`, !!result.code);
      assert(`${f} code has length`, result.code.length > 50);
    } catch (e) {
      assert(`${f} compiles to TS`, false, e.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Test 3: Compiled functions are callable
  // ---------------------------------------------------------------------------

  console.log("\n3. Function execution");

  function compileAndExec(relPath) {
    const source = readFileSync(join(ROOT, relPath), "utf-8");
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

  // Compile all files together so tools can reference core/repair functions
  function compileAll() {
    const sources = ["lin_core.lin", "lin_repair.lin", "lin_tools.lin"];
    const combined = sources.map(f => readFileSync(join(ROOT, f), "utf-8")).join("\n");
    const result = compileLia(combined, {
      target: "js",
      formalGate: false,
      skipRefineProof: true,
    });
    const exports = {};
    const mod = { exports };
    const fn = new Function("module", "exports", result.code);
    fn(mod, exports);
    return mod.exports;
  }

  let core, repair, tools;
  try {
    core = compileAndExec("lin_core.lin");
    assert("lin_core functions loaded", !!core.mkIndex);
  } catch (e) {
    assert("lin_core functions loaded", false, e.message);
  }

  try {
    repair = compileAndExec("lin_repair.lin");
    assert("lin_repair functions loaded", !!repair.classifyError);
  } catch (e) {
    assert("lin_repair functions loaded", false, e.message);
  }

  // Compile all together for tools (they need core + repair in scope)
  let all;
  try {
    all = compileAll();
    tools = all;
    assert("lin_tools functions loaded (combined)", !!tools.toolLinIndex);
  } catch (e) {
    assert("lin_tools functions loaded (combined)", false, e.message);
  }

  // ---------------------------------------------------------------------------
  // Test 4: Core operations
  // ---------------------------------------------------------------------------

  if (core) {
    console.log("\n4. Core operations");

    // mkIndex
    const idx = core.mkIndex();
    assert("mkIndex returns object", !!idx);
    assert("mkIndex has modules", typeof idx.modules === "object");
    assert("mkIndex has symbolToModules", typeof idx.symbolToModules === "object");

    // mkSymbol
    const sym = core.mkSymbol("testFn", "function", "test.lin", ["dep1"], ["io"], "testFn()");
    assert("mkSymbol name", sym.name === "testFn");
    assert("mkSymbol kind", sym.kind === "function");
    assert("mkSymbol module", sym.module === "test.lin");
    assert("mkSymbol deps", sym.deps.length === 1);
    assert("mkSymbol effects", sym.effects.length === 1);

    // mkModule
    const mod = core.mkModule("auth.lin", [sym], ["utils.lin"], ["io"], "abc123");
    assert("mkModule path", mod.path === "auth.lin");
    assert("mkModule symbols", mod.symbols.length === 1);
    assert("mkModule hash", mod.hash === "abc123");

    // indexAddModule
    core.indexAddModule(idx, mod);
    assert("indexAddModule modules count", Object.keys(idx.modules).length === 1);
    assert("indexAddModule symbol indexed", !!idx.symbolToModules["testFn"]);

    // indexQuerySymbol
    const found = core.indexQuerySymbol(idx, "testFn");
    assert("indexQuerySymbol finds", found !== null);
    assert("indexQuerySymbol result count", found.length === 1);

    const notFound = core.indexQuerySymbol(idx, "nonexistent");
    assert("indexQuerySymbol misses", notFound === null);

    // indexDependencies
    const deps = core.indexDependencies(idx, "auth.lin");
    assert("indexDependencies returns deps", deps !== null && deps.length === 1);

    // indexEffects
    const effs = core.indexEffects(idx, "auth.lin");
    assert("indexEffects returns effects", effs !== null && effs.length === 1);

    // stats
    const st = core.stats(idx);
    assert("stats modules", st.modules === 1);
    assert("stats symbols", st.symbols === 1);
    assert("stats effects", st.effects === 1);

    // verifyIdx
    const vfy = core.verifyIdx(idx);
    assert("verifyIdx ok", vfy.ok === true);

    // semanticDiff
    const oldSrc = "export function foo() { return 1; }";
    const newSrc = "export function foo() { return 2; }\nexport function bar() {}";
    const diff = core.semanticDiff(oldSrc, newSrc);
    assert("semanticDiff added bar", diff.added.length === 1);
    assert("semanticDiff added name", diff.added[0].name === "bar");
  }

  // ---------------------------------------------------------------------------
  // Test 5: Repair operations
  // ---------------------------------------------------------------------------

  if (repair) {
    console.log("\n5. Repair operations");

    // classifyError — Class A
    const syntaxErr = repair.classifyError("SyntaxError: Unexpected token");
    assert("classify syntax → A", syntaxErr.cls === "A");

    const importErr = repair.classifyError("Cannot find module 'foo'");
    assert("classify import → A", importErr.cls === "A");

    const typeErr = repair.classifyError("Type 'string' is not assignable to 'number'");
    assert("classify type → A", typeErr.cls === "A");

    // classifyError — Class B
    const runtimeErr = repair.classifyError("RuntimeError: segfault");
    assert("classify runtime → B", runtimeErr.cls === "B");

    const testErr = repair.classifyError("Test failed: expected true");
    assert("classify test → B", testErr.cls === "B");

    // classifyError — Class C
    const archErr = repair.classifyError("Circular architecture detected in module graph");
    assert("classify arch → C", archErr.cls === "C");

    // isCompilerBug
    assert("isCompilerBug lexer", repair.isCompilerBug("Unexpected token '$'"));
    assert("isCompilerBug parser", repair.isCompilerBug("Parser error at line 5"));
    assert("not compilerBug runtime", !repair.isCompilerBug("TypeError: x is not a function"));

    // repair full flow
    const result = repair.repair("Unexpected token '$'", "auth.lin", "parse", null);
    assert("repair returns result", !!result);
    assert("repair detects compiler bug", result.cls === "compiler");
    assert("repair has patch", result.patch !== null);
  }

  // ---------------------------------------------------------------------------
  // Test 6: Tool definitions
  // ---------------------------------------------------------------------------

  if (tools) {
    console.log("\n6. Tool definitions");

    const idx = core ? core.mkIndex() : null;

    const t1 = tools.toolLinIndex("/test");
    assert("toolLinIndex returns", !!t1);
    assert("toolLinIndex tool name", t1.tool === "lin_index");

    if (idx) {
      const t2 = tools.toolLinQuery(idx, "nonexistent");
      assert("toolLinQuery not_found", t2.status === "not_found");

      const t3 = tools.toolLinVerify(idx, "/test");
      assert("toolLinVerify returns", !!t3);
      assert("toolLinVerify tool name", t3.tool === "lin_verify");

      const t4 = tools.toolLinCompile("ts", "test.lin", idx);
      assert("toolLinCompile returns", !!t4);
    }

    const t5 = tools.toolLinRepair("Unexpected token '@'", "test.lin", "parse", null);
    assert("toolLinRepair returns", !!t5);
    assert("toolLinRepair tool name", t5.tool === "lin_repair");
  }

  // ---------------------------------------------------------------------------
  // Test 7: buildLinobj integration
  // ---------------------------------------------------------------------------

  if (buildLinobj) {
    console.log("\n7. buildLinobj integration");

    const sampleLin = `fn add(a, b) { return a + b }`;
    try {
      const obj = buildLinobj(sampleLin);
      assert("buildLinobj returns object", !!obj);
      assert("buildLinobj has semantic_hash", !!obj.semantic_hash);
      assert("buildLinobj has canonical_ir", !!obj.canonical_ir);
      assert("buildLinobj has type_graph", !!obj.type_graph);
      assert("buildLinobj has effect_manifest", !!obj.effect_manifest);
      assert("buildLinobj has symbol_graph", !!obj.symbol_graph);
      assert("buildLinobj has dependency_hashes", !!obj.dependency_hashes);
    } catch (e) {
      assert("buildLinobj works", false, e.message);
    }
  }
} else {
  console.log("\n2-7. Skipped (compileLia not available)");
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
