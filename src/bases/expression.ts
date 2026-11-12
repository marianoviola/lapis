import type { BasePropertyReference, BaseScalar } from './base';
import type { PropertyValue } from '../domain/note';

export type BaseExpression =
	| { readonly kind: 'literal'; readonly value: BaseScalar }
	| { readonly kind: 'property'; readonly property: BasePropertyReference }
	| { readonly kind: 'if'; readonly condition: BaseExpression; readonly yes: BaseExpression; readonly no: BaseExpression }
	| { readonly kind: 'binary'; readonly operator: string; readonly left: BaseExpression; readonly right: BaseExpression };

export const baseFileProperties = new Set(['name', 'path', 'folder', 'ext', 'ctime', 'mtime']);

export function parseBaseReference(source: string): BasePropertyReference {
	const match = /^(?:(note|file|formula)\.)?([A-Za-z_][A-Za-z0-9_-]*)$/.exec(source);
	if (!match || (match[1] === 'file' && !baseFileProperties.has(match[2]))) {
		throw new SyntaxError(`Unsupported property reference "${source}".`);
	}
	return Object.freeze({ scope: match[1] === 'file' || match[1] === 'formula' ? match[1] : 'note', name: match[2] });
}

export function parseBaseExpression(source: string): BaseExpression {
	const tokens: string[] = [];
	const lexer = /\s*("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)?|==|!=|<=|>=|&&|\|\||[<>(),])/gy;
	let offset = 0;
	while (offset < source.trimEnd().length) {
		lexer.lastIndex = offset;
		const match = lexer.exec(source);
		if (!match) {
			throw new SyntaxError(`Unsupported expression at "${source.slice(offset)}".`);
		}
		tokens.push(match[1]);
		if (tokens.length > 512) {
			throw new SyntaxError('Formula exceeds 512 tokens.');
		}
		offset = lexer.lastIndex;
	}
	let position = 0;
	const take = (expected: string) => {
		if (tokens[position++] !== expected) {
			throw new SyntaxError(`Expected "${expected}".`);
		}
	};
	const primary = (depth: number): BaseExpression => {
		if (depth > 64) {
			throw new SyntaxError('Formula nesting exceeds 64 levels.');
		}
		const token = tokens[position++];
		if (token === '(') {
			const expression = binary(0, depth + 1);
			take(')');
			return expression;
		}
		if (token === 'if') {
			take('(');
			const condition = binary(0, depth + 1);
			take(',');
			const yes = binary(0, depth + 1);
			take(',');
			const no = binary(0, depth + 1);
			take(')');
			return Object.freeze({ kind: 'if', condition, yes, no });
		}
		if (!token) {
			throw new SyntaxError('Expected an expression.');
		}
		if (token.startsWith('"') || token.startsWith("'")) {
			const value: string = token.startsWith('"') ? JSON.parse(token) : token.slice(1, -1).replace(/''/g, "'");
			return Object.freeze({ kind: 'literal', value });
		}
		if (['true', 'false', 'null'].includes(token) || /^-?\d/.test(token)) {
			const value: BaseScalar = JSON.parse(token);
			if (typeof value === 'number' && !Number.isFinite(value)) {
				throw new SyntaxError('Formula numbers must be finite.');
			}
			return Object.freeze({ kind: 'literal', value });
		}
		return Object.freeze({ kind: 'property', property: parseBaseReference(token) });
	};
	const levels = [['||'], ['&&'], ['==', '!=', '<', '<=', '>', '>=']];
	const binary = (level: number, depth: number): BaseExpression => {
		if (level === levels.length) {
			return primary(depth);
		}
		let left = binary(level + 1, depth);
		while (levels[level].includes(tokens[position])) {
			const operator = tokens[position++];
			const right = binary(level + 1, depth);
			left = Object.freeze({ kind: 'binary', operator, left, right });
		}
		return left;
	};
	const result = binary(0, 0);
	if (position !== tokens.length) {
		throw new SyntaxError(`Unexpected token "${tokens[position]}".`);
	}
	return result;
}

export function expressionReferences(expression: BaseExpression): readonly BasePropertyReference[] {
	switch (expression.kind) {
		case 'literal': return [];
		case 'property': return [expression.property];
		case 'if': return [expression.condition, expression.yes, expression.no].flatMap(expressionReferences);
		case 'binary': return [expression.left, expression.right].flatMap(expressionReferences);
	}
}

export function evaluateBaseExpression(
	expression: BaseExpression,
	resolve: (property: BasePropertyReference) => PropertyValue | undefined,
): PropertyValue | undefined {
	const evaluate = (child: BaseExpression): PropertyValue | undefined => evaluateBaseExpression(child, resolve);
	switch (expression.kind) {
		case 'literal': return expression.value;
		case 'property': return resolve(expression.property);
		case 'if': return evaluate(expression.condition) ? evaluate(expression.yes) : evaluate(expression.no);
		case 'binary': {
			const left = evaluate(expression.left);
			if (expression.operator === '||') {
				return Boolean(left || evaluate(expression.right));
			}
			if (expression.operator === '&&') {
				return Boolean(left && evaluate(expression.right));
			}
			const right = evaluate(expression.right);
			return compareBaseValues(left, expression.operator, right);
		}
	}
}

export function compareBaseValues(left: PropertyValue | undefined, operator: string, right: PropertyValue | undefined): boolean {
	if (left === undefined || right === undefined || typeof left !== typeof right
		|| (typeof left === 'object' && left !== null) || (typeof right === 'object' && right !== null)) {
		return false;
	}
	switch (operator) {
		case '==': return left === right;
		case '!=': return left !== right;
	}
	if (!(typeof left === 'number' && typeof right === 'number')
		&& !(typeof left === 'string' && typeof right === 'string')) {
		return false;
	}
	const order = typeof left === 'string' && typeof right === 'string'
		? left.localeCompare(right)
		: left === right ? 0 : Number(left) - Number(right);
	switch (operator) {
		case '<': return order < 0;
		case '<=': return order <= 0;
		case '>': return order > 0;
		case '>=': return order >= 0;
	}
	throw new Error(`Unsupported comparison operator "${operator}".`);
}
