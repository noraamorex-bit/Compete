import { CATEGORIES } from "../lib/constants.js";
import { ClockIcon, GlobeIcon, PinIcon, StarIcon } from "./Icons.jsx";

const base =
  "chip select-none bg-paper text-ink-soft ring-1 ring-ink/10 hover:ring-ink/25 active:scale-95 dark:bg-night-card dark:text-night-soft dark:ring-night-edge dark:hover:ring-night-soft/50";
const solid = "chip select-none bg-ink text-white shadow-card active:scale-95 dark:bg-night-text dark:text-night";
const amber =
  "chip select-none bg-marigold/15 text-marigold-deep ring-1 ring-marigold/50 active:scale-95 dark:text-marigold";

/** One row of everything filterable: categories, favorites, format, closing soon. */
export default function FilterBar({ filters, onChange, counts }) {
  const { category, favoritesOnly, mode, closingSoon } = filters;
  const set = (patch) => onChange({ ...filters, ...patch });

  return (
    <div className="rail -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      <button onClick={() => set({ category: null })} className={category ? base : solid}>
        All
      </button>
      {CATEGORIES.map((c) =>
        counts[c.id] ? (
          <button
            key={c.id}
            onClick={() => set({ category: category === c.id ? null : c.id })}
            className={category === c.id ? solid : base}
            aria-pressed={category === c.id}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: c.dot }} />
            {c.label}
            <span className="opacity-60">{counts[c.id]}</span>
          </button>
        ) : null
      )}

      <span className="mx-1 h-5 w-px shrink-0 bg-ink/10 dark:bg-night-edge" aria-hidden="true" />

      <button
        onClick={() => set({ favoritesOnly: !favoritesOnly })}
        className={favoritesOnly ? amber : base}
        aria-pressed={favoritesOnly}
      >
        <StarIcon size={14} filled={favoritesOnly} />
        Favorites
      </button>

      <button
        onClick={() => set({ closingSoon: !closingSoon })}
        className={closingSoon ? amber : base}
        aria-pressed={closingSoon}
      >
        <ClockIcon size={14} />
        Closing soon
      </button>

      <button
        onClick={() => set({ mode: mode === "online" ? null : "online" })}
        className={mode === "online" ? solid : base}
        aria-pressed={mode === "online"}
      >
        <GlobeIcon size={14} />
        Online
      </button>

      <button
        onClick={() => set({ mode: mode === "offline" ? null : "offline" })}
        className={mode === "offline" ? solid : base}
        aria-pressed={mode === "offline"}
      >
        <PinIcon size={14} />
        Offline
      </button>
    </div>
  );
}
