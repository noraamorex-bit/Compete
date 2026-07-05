import { useNow } from "../hooks/useNow.js";
import { formatCountdown, isPast, isClosingSoon, timeLeft } from "../lib/date.js";
import { CLOSING_SOON_DAYS } from "../lib/constants.js";

const DAY = 864e5;

/**
 * Self-ticking countdown chip. Ticks every second only when the
 * display actually shows seconds (< 1 day left); otherwise once a minute.
 * Keeps parent components free of per-second re-renders.
 */
export default function Countdown({ deadline, className = "" }) {
  const showsSeconds = timeLeft(deadline) < DAY && !isPast(deadline);
  const now = useNow(showsSeconds ? 1000 : 60000);

  const past = isPast(deadline, now);
  const soon = isClosingSoon(deadline, CLOSING_SOON_DAYS, now);

  return (
    <span
      className={`inline-flex items-center rounded-lg px-2 py-1 font-mono text-[12.5px] font-medium ${
        past
          ? "bg-ink/5 text-ink-faint dark:bg-white/5 dark:text-night-soft/70"
          : soon
            ? "bg-ember/10 text-ember"
            : "bg-leaf/10 text-leaf"
      } ${className}`}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {formatCountdown(deadline, now)}
    </span>
  );
}
