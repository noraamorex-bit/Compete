import { memo } from "react";
import Countdown from "./Countdown.jsx";
import { useNow } from "../hooks/useNow.js";
import { categoryById } from "../lib/constants.js";
import { formatDeadline, isPast, urgency } from "../lib/date.js";
import { GlobeIcon, PencilIcon, PinIcon, StarIcon, TrashIcon, TrophyIcon } from "./Icons.jsx";

const MODE_LABEL = { online: "Online", offline: "Offline", hybrid: "Hybrid" };

function CompetitionCard({ competition: c, onOpen, onEdit, onDelete, onToggleFavorite, index = 0 }) {
  const now = useNow(30000); // coarse tick: only the urgency bar & "closed" state need it
  const cat = categoryById(c.category);
  const past = isPast(c.deadline, now);
  const elapsed = urgency(c.createdAt, c.deadline, now);

  const action = "icon-btn !h-8 !w-8 sm:!h-9 sm:!w-9";

  return (
    <article
      className={`card group relative flex flex-col overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:shadow-lift ${
        past ? "opacity-60 saturate-50" : ""
      } animate-rise`}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      <button
        onClick={() => onOpen(c)}
        className="flex flex-1 flex-col p-5 pb-2.5 text-left"
        aria-label={`Open ${c.title}`}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
            style={{ background: `${cat.dot}1a`, color: cat.dot }}
          >
            <i className="h-1.5 w-1.5 rounded-full" style={{ background: cat.dot }} />
            {cat.label}
          </span>
          <Countdown deadline={c.deadline} />
        </div>

        <h3 className="font-display text-[19px] font-bold leading-snug tracking-tight transition-colors group-hover:text-marigold-deep dark:group-hover:text-marigold">
          {c.title}
        </h3>
        <p className="mt-0.5 text-[14px] text-ink-soft dark:text-night-soft">{c.organizer}</p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-soft dark:text-night-soft">
          <span className="inline-flex items-center gap-1.5">
            {c.mode === "online" ? <GlobeIcon size={15} /> : <PinIcon size={15} />}
            {c.mode === "online" ? "Online" : c.location || MODE_LABEL[c.mode]}
          </span>
          {c.prize && (
            <span className="inline-flex items-center gap-1.5">
              <TrophyIcon size={15} />
              <span className="max-w-[180px] truncate">{c.prize}</span>
            </span>
          )}
        </div>
      </button>

      {/* Footer: date + quick actions. Actions reveal on hover, always visible on touch. */}
      <div className="flex items-center justify-between gap-2 px-5 pb-3 pl-5 pr-3">
        <p className="text-[12.5px] text-ink-faint dark:text-night-soft/70">
          {past ? "Closed" : "Closes"} {formatDeadline(c.deadline)}
        </p>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onToggleFavorite(c.id)}
            className={`${action} ${
              c.favorite ? "!text-marigold" : "sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
            }`}
            aria-label={c.favorite ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={c.favorite}
          >
            <StarIcon size={16} filled={c.favorite} />
          </button>
          <button
            onClick={() => onEdit(c)}
            className={`${action} sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100`}
            aria-label={`Edit ${c.title}`}
          >
            <PencilIcon size={16} />
          </button>
          <button
            onClick={() => onDelete(c)}
            className={`${action} hover:!bg-ember/10 hover:!text-ember sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100`}
            aria-label={`Delete ${c.title}`}
          >
            <TrashIcon size={16} />
          </button>
        </div>
      </div>

      {/* Urgency meter: how much of the added → deadline window has passed. */}
      <div className="h-1 w-full bg-ink/5 dark:bg-white/5" aria-hidden="true">
        <div
          className={`h-full rounded-r-full transition-[width] duration-700 ${
            past
              ? "bg-ink/15 dark:bg-white/10"
              : elapsed > 0.75
                ? "bg-gradient-to-r from-marigold to-ember"
                : "bg-gradient-to-r from-leaf to-marigold"
          }`}
          style={{ width: `${Math.round(elapsed * 100)}%` }}
        />
      </div>
    </article>
  );
}

// Memoized: unchanged competitions keep their object identity across list
// updates, so cards only re-render when their own data changes.
export default memo(CompetitionCard);
