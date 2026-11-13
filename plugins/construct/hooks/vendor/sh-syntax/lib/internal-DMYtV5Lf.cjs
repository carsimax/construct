// \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
// src/ast.ts
function walk(value, enterOrVisitors) {
	const isEnter = typeof enterOrVisitors === "function";
	const enter = isEnter ? enterOrVisitors : enterOrVisitors.enter;
	const exit = isEnter ? null : enterOrVisitors.exit;
	const visitEntries = (container, parent) => {
		for (const [key, entry] of Object.entries(container)) if (visit(entry, parent, key, null)) return true;
		return false;
	};
	const visit = (child, parent, prop, index) => {
		if (Array.isArray(child)) {
			let i = 0;
			for (const item of child) {
				if (visit(item, parent, prop, i)) return true;
				i += 1;
			}
			return false;
		}
		if (child == null || typeof child !== "object") return false;
		if (typeof child.type !== "string") return visitEntries(child, parent);
		const node = child;
		if (enter?.(node, parent, prop, index) !== false && visitEntries(node, node)) return true;
		return exit?.(node, parent, prop, index) === false;
	};
	visit(value, null, null, null);
}
/** Reports whether an error was caused by incomplete shell source. */
const isIncomplete = (error) => Boolean(error?.incomplete);
// src/source.ts
const MAX_CODE_POINT_BYTES = 4;
const ONE_BYTE_LEAD_MAX = 127;
const TWO_BYTE_LEAD_MAX = 223;
const THREE_BYTE_LEAD_MAX = 239;
/**
* Builds a converter from a source string's UTF-8 byte offsets to UTF-16 code-unit offsets. Byte
* offsets inside a multi-byte character map to the start of that character; offsets outside the
* string are clamped.
*/
const createSourceIndex = (text) => {
	const end = text.length;
	const bytes = new TextEncoder().encode(text);
	if (bytes.length === end) return (byteOffset) => Math.min(Math.max(byteOffset, 0), end);
	const map = new Uint32Array(bytes.length + 1);
	let codeUnit = 0;
	for (let i = 0; i < bytes.length;) {
		const lead = bytes[i];
		if (lead <= ONE_BYTE_LEAD_MAX) {
			map[i] = codeUnit;
			codeUnit += 1;
			i += 1;
			continue;
		}
		let byteLength = MAX_CODE_POINT_BYTES;
		if (lead <= TWO_BYTE_LEAD_MAX) byteLength = 2;
		else if (lead <= THREE_BYTE_LEAD_MAX) byteLength = 3;
		map.fill(codeUnit, i, i + byteLength);
		codeUnit += byteLength >> 1;
		i += byteLength;
	}
	map[bytes.length] = codeUnit;
	return (byteOffset) => {
		if (byteOffset <= 0) return 0;
		return map[byteOffset] ?? end;
	};
};
// src/operators.ts
const BinAritOperator = {
	Add: 81,
	AddAssgn: 49,
	And: 10,
	AndArit: 11,
	AndAssgn: 54,
	AndBoolAssgn: 59,
	Assgn: 87,
	Comma: 98,
	Eql: 45,
	Geq: 48,
	Gtr: 63,
	Leq: 47,
	Lss: 65,
	Mul: 43,
	MulAssgn: 51,
	Neq: 46,
	Or: 13,
	OrArit: 12,
	OrAssgn: 55,
	OrBoolAssgn: 60,
	Pow: 44,
	PowAssgn: 62,
	Quo: 101,
	QuoAssgn: 52,
	Rem: 89,
	RemAssgn: 53,
	Shl: 71,
	ShlAssgn: 57,
	Shr: 64,
	ShrAssgn: 58,
	Sub: 83,
	SubAssgn: 50,
	TernColon: 104,
	TernQuest: 85,
	Xor: 96,
	XorAssgn: 56,
	XorBool: 97,
	XorBoolAssgn: 61
};
const BinCmdOperator = {
	AndStmt: 11,
	OrStmt: 12,
	Pipe: 13,
	PipeAll: 14
};
const BinTestOperator = {
	AndTest: 11,
	OrTest: 12,
	TsAfter: 63,
	TsBefore: 65,
	TsDevIno: 132,
	TsEql: 133,
	TsGeq: 136,
	TsGtr: 138,
	TsLeq: 135,
	TsLss: 137,
	TsMatch: 45,
	TsMatchShort: 87,
	TsNeq: 134,
	TsNewer: 130,
	TsNoMatch: 46,
	TsOlder: 131,
	TsReMatch: 129
};
const CaseOperator = {
	Break: 35,
	Fallthrough: 36,
	Resume: 37,
	ResumeKorn: 38
};
const GlobOperator = {
	GlobExcept: 143,
	GlobOne: 142,
	GlobOneOrMore: 141,
	GlobZeroOrMore: 140,
	GlobZeroOrOne: 139
};
const ParExpOperator = {
	AlternateUnset: 81,
	AlternateUnsetOrNull: 82,
	ArrayExclude: 94,
	ArrayIntersect: 95,
	AssignUnset: 87,
	AssignUnsetOrNull: 88,
	DefaultUnset: 83,
	DefaultUnsetOrNull: 84,
	ErrorUnset: 85,
	ErrorUnsetOrNull: 86,
	LowerAll: 99,
	LowerFirst: 98,
	MatchEmpty: 93,
	OtherParamOps: 100,
	RemLargePrefix: 92,
	RemLargeSuffix: 90,
	RemSmallPrefix: 91,
	RemSmallSuffix: 89,
	UpperAll: 97,
	UpperFirst: 96
};
const ParNamesOperator = {
	NamesPrefix: 43,
	NamesPrefixWords: 100,
	None: 0
};
const ProcOperator = {
	CmdIn: 78,
	CmdInTemp: 79,
	CmdOut: 80
};
const RedirOperator = {
	AppAll: 76,
	AppAllClob: 77,
	AppClob: 70,
	AppOut: 64,
	ClbOut: 69,
	DashHdoc: 72,
	DplIn: 67,
	DplOut: 68,
	Hdoc: 71,
	RdrAll: 74,
	RdrAllClob: 75,
	RdrClob: 69,
	RdrIn: 65,
	RdrInOut: 66,
	RdrOut: 63,
	WordHdoc: 73
};
const UnAritOperator = {
	BitNegation: 40,
	Dec: 42,
	Inc: 41,
	Minus: 83,
	Not: 39,
	Plus: 81
};
const UnTestOperator = {
	TsBlckSp: 109,
	TsCharSp: 108,
	TsDirect: 107,
	TsEmpStr: 124,
	TsExec: 121,
	TsExists: 105,
	TsFdTerm: 123,
	TsGIDSet: 114,
	TsGrpOwn: 116,
	TsModif: 118,
	TsNempStr: 125,
	TsNmPipe: 110,
	TsNoEmpty: 122,
	TsNot: 39,
	TsOptSet: 126,
	TsParen: 27,
	TsRead: 119,
	TsRefVar: 128,
	TsRegFile: 106,
	TsSmbLink: 112,
	TsSocket: 111,
	TsSticky: 113,
	TsUIDSet: 115,
	TsUsrOwn: 117,
	TsVarSet: 127,
	TsWrite: 120
};
// src/types.ts
const LangVariant = {
	/**
	* LangBash corresponds to the GNU Bash language, as described in its manual at
	* https://www.gnu.org/software/bash/manual/bash.html.
	*
	* We currently follow Bash version 5.2.
	*
	* Its string representation is "bash".
	*
	* Note: as of mvdan/sh v3.13, {@link LangVariant} values are bit flags (`1 << iota`) rather than
	* a sequential enum, so every value changed from the previous release.
	*/
	LangBash: 1,
	/**
	* LangPOSIX corresponds to the POSIX Shell language, as described at
	* https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html.
	*
	* Its string representation is "posix" or "sh".
	*/
	LangPOSIX: 2,
	/**
	* LangMirBSDKorn corresponds to the MirBSD Korn Shell, also known as mksh, as described at
	* https://www.mirbsd.org/htman/i386/man1/mksh.htm. Note that it shares some features with Bash,
	* due to the shared ancestry that is ksh.
	*
	* We currently follow mksh version 59.
	*
	* Its string representation is "mksh".
	*/
	LangMirBSDKorn: 4,
	/**
	* LangBats corresponds to the Bash Automated Testing System language, as described at
	* https://github.com/bats-core/bats-core. Note that it's just a small extension of the Bash
	* language.
	*
	* Its string representation is "bats".
	*/
	LangBats: 8,
	/**
	* LangZsh corresponds to the Z shell, as described at https://www.zsh.org/.
	*
	* Note that its support in mvdan/sh is experimental and incomplete for now; see
	* https://github.com/mvdan/sh/issues/120. We currently follow Zsh version 5.9. Added in mvdan/sh
	* v3.13.0.
	*
	* Its string representation is "zsh".
	*/
	LangZsh: 16,
	/**
	* LangAuto corresponds to automatic language detection, commonly used by end-user applications
	* like shfmt, which can guess a file's language variant given its filename or shebang.
	*
	* At this time, [Variant] does not support LangAuto.
	*/
	LangAuto: 32
};
// src/common.ts
var ParseError = class extends Error {
	constructor({ filename, incomplete, text, pos }) {
		super(text);
		this.filename = filename;
		this.incomplete = incomplete;
		this.text = text;
		this.pos = pos;
	}
};
// src/internal.ts
const MAX_STOP_AT_BYTES = 4;
const STOP_AT_OPTION_OFFSET = 16;
const supportedVariants = /* @__PURE__ */ new Set([
	LangVariant.LangBash,
	LangVariant.LangPOSIX,
	LangVariant.LangMirBSDKorn,
	LangVariant.LangBats,
	LangVariant.LangZsh
]);
let encoder;
let decoder;
const normalizeExports = (exports) => {
	const memory = exports.memory ?? exports.mem;
	return {
		...exports,
		memory
	};
};
const startGoRuntime = (go, instance) => {
	const exports = normalizeExports(instance.exports);
	if (!(exports.mem instanceof WebAssembly.Memory) || typeof exports.run !== "function") throw new TypeError("getProcessor requires a Go WASM instance");
	const run = go.run(instance);
	if (go.exited) {
		run.catch(() => void 0);
		throw new Error("Go runtime exited during startup");
	}
	return {
		go,
		exports,
		run
	};
};
const invoke = ({ memory, wasmAlloc, wasmFree, process }, textOrAst, { filepath = "", print = false, originalText, keepComments = true, variant = LangVariant.LangBash, stopAt = "", recoverErrors = 0, useTabs = false, tabWidth = 2, simplify = false, indent = useTabs ? 0 : tabWidth, binaryNextLine = true, switchCaseIndent = true, spaceRedirects = true, keepPadding = false, minify = false, singleLine = false, functionNextLine = false } = {}) => {
	encoder ??= new TextEncoder();
	decoder ??= new TextDecoder();
	if (!supportedVariants.has(variant)) throw new TypeError(`Unsupported shell variant: ${variant}`);
	let text;
	let printOutput;
	if (typeof textOrAst === "string") {
		text = textOrAst;
		printOutput = print;
	} else {
		if (originalText == null) throw new TypeError("processor(ast) is not supported; pass { originalText } to format the source text");
		text = originalText;
		printOutput = true;
	}
	const filePath = encoder.encode(filepath);
	const textBytes = encoder.encode(text);
	const stopAtBytes = encoder.encode(stopAt);
	if (stopAtBytes.byteLength > MAX_STOP_AT_BYTES) throw new TypeError("stopAt must be at most 4 bytes");
	const filePathPointer = wasmAlloc(filePath.byteLength);
	new Uint8Array(memory.buffer).set(filePath, filePathPointer);
	const textPointer = wasmAlloc(textBytes.byteLength);
	new Uint8Array(memory.buffer).set(textBytes, textPointer);
	const optionValues = [
		printOutput,
		keepComments,
		variant,
		recoverErrors,
		0,
		stopAtBytes.byteLength,
		simplify,
		indent,
		binaryNextLine,
		switchCaseIndent,
		spaceRedirects,
		keepPadding,
		minify,
		singleLine,
		functionNextLine
	];
	const optionsPointer = wasmAlloc(optionValues.length * Uint32Array.BYTES_PER_ELEMENT);
	const options = new DataView(memory.buffer, optionsPointer, optionValues.length * Uint32Array.BYTES_PER_ELEMENT);
	let optionOffset = 0;
	for (const value of optionValues) {
		options.setUint32(optionOffset, Number(value), true);
		optionOffset += Uint32Array.BYTES_PER_ELEMENT;
	}
	new Uint8Array(memory.buffer, optionsPointer + STOP_AT_OPTION_OFFSET, MAX_STOP_AT_BYTES).set(stopAtBytes);
	const resultPointer = process(filePathPointer, filePath.byteLength, textPointer, textBytes.byteLength, optionsPointer);
	wasmFree(filePathPointer);
	wasmFree(textPointer);
	wasmFree(optionsPointer);
	const result = new Uint8Array(memory.buffer).subarray(resultPointer);
	const end = result.indexOf(0);
	const string = decoder.decode(result.subarray(0, end));
	/* istanbul ignore if -- @preserve */
	if (!string.startsWith("{\"") || !string.endsWith("}")) throw new ParseError({
		filename: filepath,
		incomplete: true,
		text: string
	});
	const { file, text: processedText, parseError, message } = JSON.parse(string);
	if (parseError) throw new ParseError(parseError);
	if (message) throw new SyntaxError(message);
	return printOutput ? processedText : file;
};
Object.defineProperty(exports, "BinAritOperator", {
	enumerable: true,
	get: function() {
		return BinAritOperator;
	}
});
Object.defineProperty(exports, "BinCmdOperator", {
	enumerable: true,
	get: function() {
		return BinCmdOperator;
	}
});
Object.defineProperty(exports, "BinTestOperator", {
	enumerable: true,
	get: function() {
		return BinTestOperator;
	}
});
Object.defineProperty(exports, "CaseOperator", {
	enumerable: true,
	get: function() {
		return CaseOperator;
	}
});
Object.defineProperty(exports, "GlobOperator", {
	enumerable: true,
	get: function() {
		return GlobOperator;
	}
});
Object.defineProperty(exports, "LangVariant", {
	enumerable: true,
	get: function() {
		return LangVariant;
	}
});
Object.defineProperty(exports, "ParExpOperator", {
	enumerable: true,
	get: function() {
		return ParExpOperator;
	}
});
Object.defineProperty(exports, "ParNamesOperator", {
	enumerable: true,
	get: function() {
		return ParNamesOperator;
	}
});
Object.defineProperty(exports, "ParseError", {
	enumerable: true,
	get: function() {
		return ParseError;
	}
});
Object.defineProperty(exports, "ProcOperator", {
	enumerable: true,
	get: function() {
		return ProcOperator;
	}
});
Object.defineProperty(exports, "RedirOperator", {
	enumerable: true,
	get: function() {
		return RedirOperator;
	}
});
Object.defineProperty(exports, "UnAritOperator", {
	enumerable: true,
	get: function() {
		return UnAritOperator;
	}
});
Object.defineProperty(exports, "UnTestOperator", {
	enumerable: true,
	get: function() {
		return UnTestOperator;
	}
});
Object.defineProperty(exports, "__toESM", {
	enumerable: true,
	get: function() {
		return __toESM;
	}
});
Object.defineProperty(exports, "createSourceIndex", {
	enumerable: true,
	get: function() {
		return createSourceIndex;
	}
});
Object.defineProperty(exports, "invoke", {
	enumerable: true,
	get: function() {
		return invoke;
	}
});
Object.defineProperty(exports, "isIncomplete", {
	enumerable: true,
	get: function() {
		return isIncomplete;
	}
});
Object.defineProperty(exports, "startGoRuntime", {
	enumerable: true,
	get: function() {
		return startGoRuntime;
	}
});
Object.defineProperty(exports, "walk", {
	enumerable: true,
	get: function() {
		return walk;
	}
});
