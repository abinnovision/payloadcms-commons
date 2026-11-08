/*
 * Date groups and row times of the thread list, in local time. The panel's
 * copy is English, so names come from one English locale with 24-hour times.
 */
const LOCALE = "en-GB";

const clock = new Intl.DateTimeFormat(LOCALE, {
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
});
const weekday = new Intl.DateTimeFormat(LOCALE, { weekday: "short" });
const dayMonth = new Intl.DateTimeFormat(LOCALE, {
	day: "numeric",
	month: "short",
});
const dayMonthYear = new Intl.DateTimeFormat(LOCALE, {
	day: "numeric",
	month: "short",
	year: "numeric",
});
const month = new Intl.DateTimeFormat(LOCALE, { month: "long" });
const monthYear = new Intl.DateTimeFormat(LOCALE, {
	month: "long",
	year: "numeric",
});

/** A group of the thread list: a stable key and its heading. */
export interface DateBucket {
	key: string;
	label: string;
}

// Midnight of the day `days` before the one `now` falls on.
const startOfDay = (now: Date, days = 0): number =>
	new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).getTime();

/**
 * The group a thread's last message falls in: Today, Yesterday, Previous 7
 * days, Previous 30 days, then one per month, named with its year outside
 * the current one. A time in the future counts as today.
 */
export const dateBucket = (date: Date, now: Date): DateBucket => {
	const time = date.getTime();

	if (time >= startOfDay(now)) {
		return { key: "today", label: "Today" };
	}

	if (time >= startOfDay(now, 1)) {
		return { key: "yesterday", label: "Yesterday" };
	}

	if (time >= startOfDay(now, 7)) {
		return { key: "week", label: "Previous 7 days" };
	}

	if (time >= startOfDay(now, 30)) {
		return { key: "month", label: "Previous 30 days" };
	}

	const sameYear = date.getFullYear() === now.getFullYear();

	return {
		key: `${String(date.getFullYear())}-${String(date.getMonth() + 1)}`,
		label: (sameYear ? month : monthYear).format(date),
	};
};

/**
 * A row's time: the clock today, the weekday within seven days, the day and
 * month before that, with the year outside the current one.
 */
export const rowTime = (date: Date, now: Date): string => {
	const time = date.getTime();

	if (time >= startOfDay(now)) {
		return clock.format(date);
	}

	if (time >= startOfDay(now, 6)) {
		return weekday.format(date);
	}

	return (
		date.getFullYear() === now.getFullYear() ? dayMonth : dayMonthYear
	).format(date);
};
