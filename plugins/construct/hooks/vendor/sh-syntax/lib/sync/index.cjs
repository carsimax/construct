Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_internal = require("../internal-DMYtV5Lf.cjs");
let node_fs = require("node:fs");
let node_path = require("node:path");
node_path = require_internal.__toESM(node_path, 1);
let node_url = require("node:url");
require("../../vendors/wasm_exec.cjs");
// src/sync/api.ts
/** Binds the synchronous parse/print surface to a sync processor. */
const createProcessorAPI = (processor) => ({
	parse: (text, options) => processor(text, options),
	print: (textOrAst, options) => {
		if (typeof textOrAst === "string") return processor(textOrAst, {
			...options,
			print: true
		});
		return processor(textOrAst, options);
	}
});
// src/sync/processor.ts
/**
* Creates a synchronous processor from WASM bytes, a synchronous loader, or a compiled module.
*
* The Go runtime is created once and reused. Standard Go WASM uses the normal Go GC, so the
* instance can serve repeated synchronous calls.
*/
const getProcessor = (getWasm) => {
	const source = typeof getWasm === "function" ? getWasm() : getWasm;
	const module = source instanceof WebAssembly.Module ? source : new WebAssembly.Module(source);
	const createRuntime = () => {
		const go = new Go();
		const instance = new WebAssembly.Instance(module, go.importObject);
		const runtime = require_internal.startGoRuntime(go, instance);
		runtime.run.catch((error) => {
			runtime.failure = { error };
		});
		return runtime;
	};
	let runtime = createRuntime();
	function processor(textOrAst, options) {
		if (runtime.failure) throw runtime.failure.error;
		/* istanbul ignore if -- @preserve */
		if (runtime.go.exited) runtime = createRuntime();
		return require_internal.invoke(runtime.exports, textOrAst, options);
	}
	return processor;
};
// src/sync/index.ts
const importMetaUrl = require("url").pathToFileURL(__filename).href;
/* istanbul ignore next -- @preserve */
const moduleDir = importMetaUrl ? node_path.default.dirname((0, node_url.fileURLToPath)(importMetaUrl)) : __dirname;
const processor = getProcessor((0, node_fs.readFileSync)(node_path.default.resolve(moduleDir, "../../main.wasm")));
const { parse, print } = createProcessorAPI(processor);
exports.BinAritOperator = require_internal.BinAritOperator;
exports.BinCmdOperator = require_internal.BinCmdOperator;
exports.BinTestOperator = require_internal.BinTestOperator;
exports.CaseOperator = require_internal.CaseOperator;
exports.GlobOperator = require_internal.GlobOperator;
exports.LangVariant = require_internal.LangVariant;
exports.ParExpOperator = require_internal.ParExpOperator;
exports.ParNamesOperator = require_internal.ParNamesOperator;
exports.ParseError = require_internal.ParseError;
exports.ProcOperator = require_internal.ProcOperator;
exports.RedirOperator = require_internal.RedirOperator;
exports.UnAritOperator = require_internal.UnAritOperator;
exports.UnTestOperator = require_internal.UnTestOperator;
exports.createSourceIndex = require_internal.createSourceIndex;
exports.getProcessor = getProcessor;
exports.isIncomplete = require_internal.isIncomplete;
exports.parse = parse;
exports.print = print;
exports.processor = processor;
exports.walk = require_internal.walk;
