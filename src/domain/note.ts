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

/** UTF-16 offsets in the original document; end is exclusive. */
export interface SourceRange {
	readonly start: number;
	readonly end: number;
}

export interface NoteLinkOccurrence extends NoteLink {
	readonly range: SourceRange;
	readonly targetRange: SourceRange;
	readonly headingRange?: SourceRange;
	readonly labelRange?: SourceRange;
}

export interface Heading {
	readonly text: string;
	readonly slug: string;
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
	readonly links: readonly NoteLinkOccurrence[];
	readonly issues: readonly NoteIssue[];
	readonly dirty: boolean;
	readonly documentVersion?: number;
	readonly ctime?: number;
	readonly mtime?: number;
}