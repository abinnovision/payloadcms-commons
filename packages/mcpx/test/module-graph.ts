import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const resolveRelative = (fromFile: string, specifier: string): string => {
	const base = resolve(dirname(fromFile), specifier);
	const withExt = base.endsWith(".js")
		? `${base.slice(0, -3)}.ts`
		: `${base}.ts`;
	try {
		readFileSync(withExt, "utf8");

		return withExt;
	} catch {
		return withExt.replace(/\.ts$/, ".tsx");
	}
};

interface Specifier {
	text: string;
	typeOnly: boolean;
}

/*
 * Parsed rather than matched, so every form the compiler accepts is seen:
 * clauses spanning lines or holding comments, string-named specifiers and
 * dynamic imports alike. `import { type A }` counts as a value import, the
 * conservative reading: whether the statement survives depends on the
 * compiler settings.
 */
const specifiersOf = (file: string): Specifier[] => {
	const source = ts.createSourceFile(
		file,
		readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		false,
		file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const found: Specifier[] = [];

	const visit = (node: ts.Node): void => {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			found.push({
				text: node.moduleSpecifier.text,
				typeOnly: ts.isImportDeclaration(node)
					? node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
					: node.isTypeOnly,
			});
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments[0] &&
			ts.isStringLiteral(node.arguments[0])
		) {
			found.push({ text: node.arguments[0].text, typeOnly: false });
		}

		ts.forEachChild(node, visit);
	};

	visit(source);

	return found;
};

interface ModuleGraph {
	files: Set<string>;
	bareSpecifiers: Set<string>;
	/** The files each walked file imports directly. */
	imports: Map<string, Set<string>>;
}

export interface WalkOptions {
	/**
	 * Follow `import type` and `export type` as well.
	 *
	 * Off by default, because a type-only import erases and so cannot reach a
	 * consumer's bundle, which is what the entrypoint boundary assertions are
	 * about. The layering assertions are about design: a lower layer naming a
	 * higher layer's type is a dependency in the forbidden direction all the
	 * same.
	 */
	includeTypeImports?: boolean;
}

/**
 * Walks the import graph reachable from `entryFile`. Type-only imports and
 * exports are left out unless `includeTypeImports` is set.
 *
 * This duplicates what the eslint `no-restricted-imports` patterns express,
 * on purpose. The lint rule constrains one file at a time; this constrains
 * everything an entrypoint transitively pulls in, which is the property that
 * matters to a consumer's bundler.
 */
export const walkModuleGraph = (
	entryFile: string,
	options: WalkOptions = {},
): ModuleGraph => {
	const files = new Set<string>();
	const bareSpecifiers = new Set<string>();
	const imports = new Map<string, Set<string>>();
	const queue = [entryFile];

	while (queue.length > 0) {
		const file = queue.pop();
		if (!file || files.has(file)) {
			continue;
		}

		files.add(file);

		const own = new Set<string>();
		imports.set(file, own);

		for (const { text, typeOnly } of specifiersOf(file)) {
			if (typeOnly && !options.includeTypeImports) {
				continue;
			}

			if (text.startsWith(".")) {
				const resolved = resolveRelative(file, text);

				own.add(resolved);
				queue.push(resolved);
			} else {
				bareSpecifiers.add(text);
			}
		}
	}

	return { files, bareSpecifiers, imports };
};
