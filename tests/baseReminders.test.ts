import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { futureDateProperties, localDateTime, parseReminderDate, ReminderScheduler, type NoteReminder } from '../src/bases/reminders';

describe('Base reminder dates', () => {
	it('accepts ISO calendar dates and timestamps without rolling over invalid calendar fields', () => {
		expect(localDateTime(parseReminderDate('2028-02-29')!)).toBe('2028-02-29T09:00');
		expect(parseReminderDate('2028-02-29T10:30:20.123+02:00')).toBe(Date.parse('2028-02-29T08:30:20.123Z'));
		for (const value of ['2027-02-29', '2026-04-31', '2026-00-01', '2026-13-01', 'tomorrow', '2026:07- 04', '2026-12-01T24:00', '2026-12-01T12:60', '2026-12-01T12:00:60', '2026-12-01T12:00+25:00']) {
			expect(parseReminderDate(value), value).toBeUndefined();
		}
	});

	it('selects only future scalar ISO date properties', () => {
		const now = Date.parse('2026-01-01T00:00Z');
		expect(futureDateProperties({
			due: '2027-01-01', past: '2020-01-01', invalid: '2027-02-30',
			number: 1800000000000, object: { due: '2027-01-01' }, list: ['2027-01-01'],
		}, now)).toEqual([{ property: 'due', value: '2027-01-01' }]);
	});

	it('rejects nonexistent local times during daylight-saving transitions', () => {
		vi.stubEnv('TZ', 'Europe/Rome');
		try {
			expect(parseReminderDate('2026-03-29T02:30')).toBeUndefined();
			expect(localDateTime(parseReminderDate('2026-03-29T03:30')!)).toBe('2026-03-29T03:30');
			expect(parseReminderDate('2026-03-29T02:30Z')).toBe(Date.parse('2026-03-29T02:30Z'));
		} finally {
			vi.unstubAllEnvs();
		}
	});
});

describe('persistent Base reminder scheduler', () => {
	const now = Date.parse('2026-01-01T10:00Z');
	const reminder = (seconds = 10): NoteReminder => ({
		noteUri: 'file:///vault/post.md', title: 'Post', property: 'due', due: now + seconds * 1000,
	});
	const schedulers: ReminderScheduler[] = [];

	function create(stored: unknown = undefined, write = vi.fn(async (_value: readonly NoteReminder[]) => {})) {
		const notify = vi.fn(), changed = vi.fn(), error = vi.fn();
		const scheduler = new ReminderScheduler({ read: () => stored, write }, notify, changed, error);
		schedulers.push(scheduler);
		return { scheduler, notify, changed, error, write };
	}

	beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
	afterEach(() => { schedulers.forEach(scheduler => scheduler.dispose()); schedulers.length = 0; vi.useRealTimers(); });

	it('persists before success and fires exactly once, removing the stored alert first', async () => {
		const { scheduler, write, notify } = create();
		await scheduler.set(reminder());
		expect(write).toHaveBeenCalledWith([reminder()]);
		expect(notify).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(write).toHaveBeenLastCalledWith([]);
		expect(notify).toHaveBeenCalledExactlyOnceWith(reminder());
		await vi.advanceTimersByTimeAsync(60_000);
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it('restores future reminders and catches overdue reminders on the next launch', async () => {
		const future = create([reminder(10)]);
		const overdue = create([reminder(-10)]);
		await vi.advanceTimersByTimeAsync(0);
		expect(future.notify).not.toHaveBeenCalled();
		expect(overdue.notify).toHaveBeenCalledExactlyOnceWith(reminder(-10));
		await vi.advanceTimersByTimeAsync(10_000);
		expect(future.notify).toHaveBeenCalledTimes(1);
	});

	it('changes and cancels reminders and moves folder descendants', async () => {
		const { scheduler, notify } = create();
		await scheduler.set(reminder());
		await scheduler.set(reminder(20));
		expect(scheduler.getAll()).toEqual([reminder(20)]);
		await scheduler.relocate('file:///vault', 'file:///renamed');
		expect(scheduler.getAll()[0].noteUri).toBe('file:///renamed/post.md');
		await scheduler.relocate('file:///renamed');
		expect(scheduler.getAll()).toEqual([]);
		await scheduler.set(reminder());
		await scheduler.remove(reminder().noteUri);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(notify).not.toHaveBeenCalled();
	});

	it('does not lose concurrent saves or removals', async () => {
		const { scheduler } = create();
		await Promise.all([
			scheduler.set(reminder()),
			scheduler.set({ ...reminder(), noteUri: 'file:///vault/second.md' }),
			scheduler.remove(reminder().noteUri),
		]);
		expect(scheduler.getAll().map(item => item.noteUri)).toEqual(['file:///vault/second.md']);
	});

	it('rejects failed writes without committing in-memory success and allows retries', async () => {
		const write = vi.fn().mockRejectedValueOnce(new Error('Disk unavailable')).mockResolvedValue(undefined);
		const { scheduler } = create(undefined, write);
		await expect(scheduler.set(reminder())).rejects.toThrow('Disk unavailable');
		expect(scheduler.getAll()).toEqual([]);
		await scheduler.set(reminder());
		expect(scheduler.getAll()).toEqual([reminder()]);
	});

	it('reports failed due persistence and retries rather than notifying prematurely', async () => {
		const write = vi.fn().mockRejectedValueOnce(new Error('Disk unavailable')).mockResolvedValue(undefined);
		const { scheduler, notify, error } = create([reminder(-1)], write);
		await vi.advanceTimersByTimeAsync(0);
		expect(notify).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledOnce();
		expect(scheduler.getAll()).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(60_001);
		expect(notify).toHaveBeenCalledOnce();
	});

	it('bounds long waits, handles clock jumps and stops on disposal', async () => {
		const { scheduler, notify, write } = create([reminder(60 * 60 * 24 * 60)]);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(notify).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
		vi.setSystemTime(now + 1000 * 60 * 60 * 24 * 61);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(notify).toHaveBeenCalledOnce();
		await scheduler.set({ ...reminder(), due: Date.now() + 5000 });
		scheduler.dispose();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it('reports malformed or duplicate persisted data and blocks subsequent overwrites', async () => {
		for (const stored of ['bad', [reminder(), reminder()], [{ ...reminder(), due: 'tomorrow' }]]) {
			const { scheduler, write, error } = create(stored);
			expect(error).toHaveBeenCalledOnce();
			expect(scheduler.getAll()).toEqual([]);
			await expect(scheduler.set(reminder())).rejects.toThrow('Saved Lapis reminders are invalid');
			await expect(scheduler.remove(reminder().noteUri)).rejects.toThrow('Saved Lapis reminders are invalid');
			expect(write).not.toHaveBeenCalled();
		}
	});

	it('rejects past and invalid reminders and protects state from caller mutation', async () => {
		const { scheduler } = create();
		await expect(scheduler.set(reminder(-1))).rejects.toThrow('future');
		await expect(scheduler.set({ ...reminder(), due: NaN })).rejects.toThrow('future');
		await scheduler.set(reminder());
		const snapshot = scheduler.getAll();
		Object.assign(snapshot[0], { title: 'changed' });
		expect(scheduler.getAll()[0].title).toBe('Post');
	});
});
