export type PropertyValue = string | number | boolean | null | readonly PropertyValue[] | Properties;

export interface Properties {
	readonly [key: string]: PropertyValue;
}

export interface NoteLink {
	readonly target: string;
	readonly heading?: string;
	readonly label?: string;
	readonly embed: boolean;
}

export interface Heading {
	readonly text: string;
	readonly level: number;
	readonly line: number;
}

export interface NoteIssue {
	readonly message: string;
	readonly line: number;
}

export interface NoteSource {
	readonly uri: string;
	readonly rootUri: string;
	readonly relativePath: string;
	readonly text: string;
	readonly dirty: boolean;
	readonly documentVersion?: number;
	readonly ctime?: number;
	readonly mtime?: number;
}

export interface NoteRecord {
	readonly id: string;
	readonly rootUri: string;
	readonly relativePath: string;
	readonly filename: string;
	readonly title: string;
	readonly properties: Properties;
	readonly headings: readonly Heading[];
	readonly links: readonly NoteLink[];
	readonly issues: readonly NoteIssue[];
	readonly dirty: boolean;
	readonly documentVersion?: number;
	readonly ctime?: number;
	readonly mtime?: number;
}