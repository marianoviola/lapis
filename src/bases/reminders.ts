import type { Properties } from '../domain/note';

export interface NoteReminder {
	readonly noteUri: string;
	readonly title: string;
	readonly property: string;
	readonly due: number;
}

export interface ReminderStorage {
	read(): unknown;
	write(reminders: readonly NoteReminder[]): PromiseLike<void>;
}

export function parseReminderDate(value: string): number | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
	if (!match) {
		return undefined;
	}
	const [, year, month, day, hour, minute, second, zone] = match;
	const calendar = new Date(0);
	calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
	if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1
		|| calendar.getUTCDate() !== Number(day) || Number(hour ?? 0) > 23 || Number(minute ?? 0) > 59
		|| Number(second ?? 0) > 59 || (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) {
		return undefined;
	}
	const timestamp = Date.parse(hour === undefined ? `${value}T09:00` : value);
	if (!zone && hour !== undefined && Number.isFinite(timestamp)) {
		const local = new Date(timestamp);
		if (local.getHours() !== Number(hour) || local.getMinutes() !== Number(minute)) {
			return undefined;
		}
	}
	return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function futureDateProperties(properties: Properties, now = Date.now()): readonly { property: string; value: string }[] {
	return Object.entries(properties).flatMap(([property, value]) => {
		if (typeof value !== 'string') {
			return [];
		}
		const timestamp = parseReminderDate(value);
		return timestamp !== undefined && timestamp > now ? [{ property, value }] : [];
	});
}

export function localDateTime(timestamp: number): string {
	const date = new Date(timestamp);
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Workspace-local persistence; note frontmatter is never changed. */
export class ReminderScheduler {
	private reminders: readonly NoteReminder[] = [];
	private timer?: ReturnType<typeof setTimeout>;
	private pending: Promise<void> = Promise.resolve();
	private disposed = false;
	private loadError?: Error;

	constructor(
		private readonly storage: ReminderStorage,
		private readonly notify: (reminder: NoteReminder) => void,
		private readonly changed: () => void,
		private readonly reportError: (error: unknown) => void,
	) {
		const stored = storage.read();
		if (stored !== undefined) {
			if (!Array.isArray(stored) || !stored.every(isReminder)
				|| new Set(stored.map(item => item.noteUri)).size !== stored.length) {
				this.loadError = new Error('Saved Lapis reminders are invalid. They have not been loaded or overwritten.');
				reportError(this.loadError);
				return;
			}
			this.reminders = stored;
		}
		this.arm();
	}

	getAll(): readonly NoteReminder[] {
		return this.reminders.map(reminder => ({ ...reminder }));
	}

	set(reminder: NoteReminder): Promise<void> {
		if (!isReminder(reminder) || reminder.due <= Date.now()) {
			return Promise.reject(new Error('Choose a valid future date and time for the reminder.'));
		}
		return this.update(reminders => [...reminders.filter(item => item.noteUri !== reminder.noteUri), { ...reminder }]);
	}

	remove(noteUri: string): Promise<void> {
		return this.update(reminders => reminders.filter(item => item.noteUri !== noteUri));
	}

	relocate(from: string, to?: string): Promise<void> {
		const prefix = from.endsWith('/') ? from : `${from}/`;
		return this.update(reminders => reminders.flatMap(reminder => {
			if (reminder.noteUri !== from && !reminder.noteUri.startsWith(prefix)) {
				return [reminder];
			}
			return to ? [{ ...reminder, noteUri: to + reminder.noteUri.slice(from.length) }] : [];
		}));
	}

	dispose(): void {
		this.disposed = true;
		clearTimeout(this.timer);
	}

	private update(change: (reminders: readonly NoteReminder[]) => readonly NoteReminder[]): Promise<void> {
		const operation = this.pending.then(async () => {
			if (this.disposed) {
				throw new Error('The reminder scheduler has been closed.');
			}
			if (this.loadError) {
				throw this.loadError;
			}
			const next = change(this.reminders);
			await this.storage.write(next);
			this.reminders = next;
			this.arm();
			if (!this.disposed) {
				this.changed();
			}
		});
		// Keep subsequent writes usable; each caller receives and reports its own rejection.
		this.pending = operation.then(() => undefined, () => undefined);
		return operation;
	}

	private arm(): void {
		clearTimeout(this.timer);
		if (this.disposed || !this.reminders.length) {
			return;
		}
		const next = Math.min(...this.reminders.map(reminder => reminder.due));
		this.timer = setTimeout(() => {
			void this.deliver().catch(error => {
				this.reportError(error);
				if (!this.disposed) {
					this.timer = setTimeout(() => this.arm(), 60_000);
				}
			});
		}, Math.max(0, Math.min(next - Date.now(), 60_000)));
	}

	private async deliver(): Promise<void> {
		if (!this.reminders.some(reminder => reminder.due <= Date.now())) {
			this.arm();
			return;
		}
		let due: readonly NoteReminder[] = [];
		await this.update(reminders => {
			due = reminders.filter(reminder => reminder.due <= Date.now());
			return reminders.filter(reminder => reminder.due > Date.now());
		});
		if (!this.disposed) {
			for (const reminder of due) {
				this.notify(reminder);
			}
		}
	}
}

function isReminder(value: unknown): value is NoteReminder {
	return typeof value === 'object' && value !== null
		&& 'noteUri' in value && typeof value.noteUri === 'string' && value.noteUri.startsWith('file:')
		&& 'title' in value && typeof value.title === 'string'
		&& 'property' in value && typeof value.property === 'string'
		&& 'due' in value && typeof value.due === 'number' && Number.isFinite(value.due);
}
