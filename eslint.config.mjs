// ESLint flat config using the official Obsidian plugin guidelines
// (https://github.com/obsidianmd/eslint-plugin) plus typescript-eslint's
// strict-type-checked preset (adopted 2026-08-10)
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default defineConfig([
	...obsidianmd.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { project: "./tsconfig.json" },
		},
		rules: {
			// numbers interpolate losslessly; everything else stays strict
			"@typescript-eslint/restrict-template-expressions": [
				"error",
				{ allowNumber: true },
			],
		},
	},
	{
		// test doubles legitimately mirror external CLASS shapes with empty
		// or static-only classes: test/mocks/obsidian.ts stubs the obsidian
		// package's class exports, and the table smoke-twin builds fake
		// CodeMirror view classes — no-extraneous-class would force fake
		// instance state onto shapes whose emptiness is the point
		files: ["test/**/*.ts"],
		rules: {
			"@typescript-eslint/no-extraneous-class": "off",
			// tests run under node, where the Obsidian guideline's
			// window/activeWindow globals do not exist — its auto-fix
			// rewrote a globalThis slot to `window` and broke the suite
			"obsidianmd/no-global-this": "off",
			// for the same reason Node's modules are fine in tests: the referee
			// suite reads Obsidian's saved answers with node:fs
			"obsidianmd/no-nodejs-modules": "off",
		},
	},
	{
		// remark-parse-list.js and remark-parse-tokenizer.js are remark-parse 8's list reader and tokenizer loop, vendored as
		// plain JavaScript and kept as close to upstream as possible
		ignores: ["node_modules/**", "main.js", "scripts/**", "src/parsing/remark-parse-list.js", "src/parsing/remark-parse-tokenizer.js"],
	},
]);
