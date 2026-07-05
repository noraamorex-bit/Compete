const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Milliseconds from `now` until `deadline` (negative if past). */
export function timeLeft(deadline, now = Date.now()) {
  return new Date(deadline).getTime() - now;
}

export function isPast(deadline, now = Date.now()) {
  return timeLeft(deadline, now) <= 0;
}

export function isClosingSoon(deadline, days, now = Date.now()) {
  const left = timeLeft(deadline, now);
  return left > 0 && left <= days * DAY;
}

/** "3d 04h 12m", "5h 12m 08s", "42m 10s" — compact live countdown. */
export function formatCountdown(deadline, now = Date.now()) {
  let ms = timeLeft(deadline, now);
  if (ms <= 0) return "Closed";
  const d = Math.floor(ms / DAY);
  ms -= d * DAY;
  const h = Math.floor(ms / HOUR);
  ms -= h * HOUR;
  const m = Math.floor(ms / MIN);
  const s = Math.floor((ms - m * MIN) / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  return `${m}m ${pad(s)}s`;
}

/** "3 days left" style phrase for cards. */
export function relativePhrase(deadline, now = Date.now()) {
  const ms = timeLeft(deadline, now);
  if (ms <= 0) return "Closed";
  const d = Math.floor(ms / DAY);
  if (d >= 2) return `${d} days left`;
  if (d === 1) return "1 day left";
  const h = Math.floor(ms / HOUR);
  if (h >= 1) return `${h}h left`;
  return `${Math.max(1, Math.floor(ms / MIN))}m left`;
}

export function formatDeadline(deadline) {
  const dt = new Date(deadline);
  const date = dt.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = dt.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

/** Value for <input type="datetime-local"> in the user's local time. */
export function toLocalInputValue(iso) {
  const d = iso ? new Date(iso) : new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * MIN).toISOString().slice(0, 16);
}

/** Share of the added → deadline window already elapsed, 0..1. */
export function urgency(createdAt, deadline, now = Date.now()) {
  const start = new Date(createdAt).getTime();
  const end = new Date(deadline).getTime();
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}
