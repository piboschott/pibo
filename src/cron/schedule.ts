import type { PiboCronSchedule, PiboCronScheduleUi } from "./types.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type FriendlyScheduleInput =
	| { kind: "in"; value: string }
	| { kind: "at"; value: string; tz?: string }
	| { kind: "every"; value: string }
	| { kind: "daily"; time: string; tz?: string }
	| { kind: "weekly"; weekdays: string | number[]; time: string; tz?: string }
	| { kind: "monthly"; dayOfMonth: number; time: string; tz?: string }
	| { kind: "cron"; expr: string; tz?: string };

export function validateSchedule(schedule: PiboCronSchedule): void {
	switch (schedule.kind) {
		case "at": {
			const date = new Date(schedule.at);
			if (Number.isNaN(date.getTime())) throw new Error("schedule.at must be a valid date");
			return;
		}
		case "every":
			if (!Number.isFinite(schedule.everyMs) || schedule.everyMs < MINUTE_MS) throw new Error("schedule.everyMs must be at least one minute");
			if (schedule.anchorMs !== undefined && !Number.isFinite(schedule.anchorMs)) throw new Error("schedule.anchorMs must be finite");
			return;
		case "cron":
			parseCron(schedule.expr);
			if (schedule.tz) validateTimeZone(schedule.tz);
			return;
	}
}

export function computeNextRunAt(schedule: PiboCronSchedule, now = new Date()): Date | undefined {
	validateSchedule(schedule);
	switch (schedule.kind) {
		case "at": {
			const at = new Date(schedule.at);
			return at.getTime() > now.getTime() ? at : undefined;
		}
		case "every": {
			const anchor = schedule.anchorMs ?? 0;
			const elapsed = now.getTime() - anchor;
			const steps = Math.floor(elapsed / schedule.everyMs) + 1;
			return new Date(anchor + Math.max(1, steps) * schedule.everyMs);
		}
		case "cron":
			return computeNextCronRunAt(schedule.expr, now, schedule.tz);
	}
}

export function parseFriendlySchedule(input: FriendlyScheduleInput, now = new Date()): { schedule: PiboCronSchedule; scheduleUi?: PiboCronScheduleUi } {
	switch (input.kind) {
		case "in": {
			const everyMs = parseDurationMs(input.value);
			const unit = uiUnit(everyMs);
			const schedule = { kind: "at" as const, at: new Date(now.getTime() + everyMs).toISOString() };
			return { schedule, scheduleUi: { preset: "in", amount: amountForUnit(everyMs, unit), unit } };
		}
		case "at":
			return { schedule: { kind: "at", at: new Date(input.value).toISOString() }, scheduleUi: { preset: "at", localDateTime: input.value, tz: input.tz } };
		case "every": {
			const everyMs = parseDurationMs(input.value);
			const unit = uiUnit(everyMs);
			return { schedule: { kind: "every", everyMs, anchorMs: now.getTime() }, scheduleUi: { preset: "every", amount: amountForUnit(everyMs, unit), unit } };
		}
		case "daily": {
			const { hour, minute } = parseTime(input.time);
			return { schedule: { kind: "cron", expr: `${minute} ${hour} * * *`, tz: input.tz }, scheduleUi: { preset: "daily", time: input.time, tz: input.tz } };
		}
		case "weekly": {
			const { hour, minute } = parseTime(input.time);
			const weekdays = Array.isArray(input.weekdays) ? input.weekdays : parseWeekdays(input.weekdays);
			return { schedule: { kind: "cron", expr: `${minute} ${hour} * * ${weekdays.join(",")}`, tz: input.tz }, scheduleUi: { preset: "weekly", weekdays, time: input.time, tz: input.tz } };
		}
		case "monthly": {
			const { hour, minute } = parseTime(input.time);
			if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31) throw new Error("monthly day must be between 1 and 31");
			return { schedule: { kind: "cron", expr: `${minute} ${hour} ${input.dayOfMonth} * *`, tz: input.tz }, scheduleUi: { preset: "monthly", dayOfMonth: input.dayOfMonth, time: input.time, tz: input.tz } };
		}
		case "cron":
			return { schedule: { kind: "cron", expr: input.expr, tz: input.tz }, scheduleUi: { preset: "advanced", expr: input.expr, tz: input.tz } };
	}
}

export function formatSchedule(schedule: PiboCronSchedule, scheduleUi?: PiboCronScheduleUi): string {
	if (scheduleUi) {
		switch (scheduleUi.preset) {
			case "in": return `in ${scheduleUi.amount} ${scheduleUi.unit}`;
			case "at": return `at ${scheduleUi.localDateTime}`;
			case "every": return `every ${scheduleUi.amount} ${scheduleUi.unit}`;
			case "daily": return `daily at ${scheduleUi.time}`;
			case "weekly": return `weekly ${scheduleUi.weekdays.join(",")} at ${scheduleUi.time}`;
			case "monthly": return `monthly on day ${scheduleUi.dayOfMonth} at ${scheduleUi.time}`;
			case "advanced": return `cron ${scheduleUi.expr}`;
		}
	}
	if (schedule.kind === "at") return `at ${schedule.at}`;
	if (schedule.kind === "every") return `every ${formatDuration(schedule.everyMs)}`;
	return `cron ${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ""}`;
}

export function parseDurationMs(value: string): number {
	const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/i);
	if (!match) throw new Error("Duration must look like 20m, 2h, or 1d");
	const amount = Number(match[1]);
	const unit = match[2].toLowerCase();
	const ms = unit.startsWith("m") ? amount * MINUTE_MS : unit.startsWith("h") ? amount * HOUR_MS : amount * DAY_MS;
	if (!Number.isFinite(ms) || ms < MINUTE_MS) throw new Error("Duration must be at least one minute");
	return Math.round(ms);
}

function formatDuration(ms: number): string {
	if (ms % DAY_MS === 0) return `${ms / DAY_MS}d`;
	if (ms % HOUR_MS === 0) return `${ms / HOUR_MS}h`;
	return `${Math.round(ms / MINUTE_MS)}m`;
}

function uiUnit(ms: number): "minutes" | "hours" | "days" {
	if (ms % DAY_MS === 0) return "days";
	if (ms % HOUR_MS === 0) return "hours";
	return "minutes";
}

function amountForUnit(ms: number, unit: "minutes" | "hours" | "days"): number {
	return unit === "days" ? ms / DAY_MS : unit === "hours" ? ms / HOUR_MS : ms / MINUTE_MS;
}

function parseTime(value: string): { hour: number; minute: number } {
	const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
	if (!match) throw new Error("Time must use HH:MM");
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error("Time is out of range");
	return { hour, minute };
}

function parseWeekdays(value: string): number[] {
	const names = new Map([["sun", 0], ["mon", 1], ["tue", 2], ["wed", 3], ["thu", 4], ["fri", 5], ["sat", 6]]);
	const days = value.split(",").map((part) => {
		const text = part.trim().toLowerCase();
		const numeric = Number(text);
		const day = Number.isInteger(numeric) ? numeric : names.get(text.slice(0, 3));
		if (day === undefined || day < 0 || day > 6) throw new Error(`Invalid weekday: ${part}`);
		return day;
	});
	if (days.length === 0) throw new Error("At least one weekday is required");
	return [...new Set(days)].sort();
}

type CronSpec = { minutes: Set<number>; hours: Set<number>; days: Set<number>; months: Set<number>; weekdays: Set<number> };

function parseCron(expr: string): CronSpec {
	const fields = expr.trim().split(/\s+/);
	if (fields.length !== 5) throw new Error("Cron expression must have 5 fields: minute hour day month weekday");
	return {
		minutes: parseCronField(fields[0], 0, 59, "minute"),
		hours: parseCronField(fields[1], 0, 23, "hour"),
		days: parseCronField(fields[2], 1, 31, "day"),
		months: parseCronField(fields[3], 1, 12, "month"),
		weekdays: parseCronField(fields[4], 0, 7, "weekday", (value) => value === 7 ? 0 : value),
	};
}

function parseCronField(field: string, min: number, max: number, label: string, mapValue: (value: number) => number = (value) => value): Set<number> {
	const values = new Set<number>();
	for (const part of field.split(",")) {
		const [rangePart, stepPart] = part.split("/");
		const step = stepPart === undefined ? 1 : Number(stepPart);
		if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid ${label} step`);
		let start: number;
		let end: number;
		if (rangePart === "*") {
			start = min;
			end = max;
		} else if (rangePart.includes("-")) {
			const [left, right] = rangePart.split("-").map(Number);
			start = left;
			end = right;
		} else {
			start = Number(rangePart);
			end = start;
		}
		if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) throw new Error(`Invalid ${label} field`);
		for (let value = start; value <= end; value += step) values.add(mapValue(value));
	}
	return values;
}

function computeNextCronRunAt(expr: string, now: Date, tz?: string): Date | undefined {
	const spec = parseCron(expr);
	const start = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS);
	const max = start.getTime() + 5 * 366 * DAY_MS;
	for (let time = start.getTime(); time <= max; time += MINUTE_MS) {
		const date = new Date(time);
		const parts = cronDateParts(date, tz);
		if (spec.minutes.has(parts.minute) && spec.hours.has(parts.hour) && spec.days.has(parts.day) && spec.months.has(parts.month) && spec.weekdays.has(parts.weekday)) return date;
	}
	return undefined;
}

function cronDateParts(date: Date, tz?: string): { minute: number; hour: number; day: number; month: number; weekday: number } {
	if (!tz) return { minute: date.getMinutes(), hour: date.getHours(), day: date.getDate(), month: date.getMonth() + 1, weekday: date.getDay() };
	const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, minute: "numeric", hour: "numeric", day: "numeric", month: "numeric", weekday: "short", hour12: false }).formatToParts(date);
	const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
	const weekdays = new Map([["Sun", 0], ["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6]]);
	return { minute: get("minute"), hour: get("hour") % 24, day: get("day"), month: get("month"), weekday: weekdays.get(parts.find((part) => part.type === "weekday")?.value ?? "") ?? 0 };
}

function validateTimeZone(tz: string): void {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
	} catch {
		throw new Error(`Invalid timezone: ${tz}`);
	}
}
