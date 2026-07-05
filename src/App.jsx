import { useCallback, useDeferredValue, useMemo, useState } from "react";
import Header from "./components/Header.jsx";
import Spotlight from "./components/Spotlight.jsx";
import FilterBar from "./components/FilterBar.jsx";
import CompetitionCard from "./components/CompetitionCard.jsx";
import CompetitionForm from "./components/CompetitionForm.jsx";
import CompetitionDetails from "./components/CompetitionDetails.jsx";
import ConfirmDialog from "./components/ConfirmDialog.jsx";
import EmptyState from "./components/EmptyState.jsx";
import { useCompetitions } from "./hooks/useCompetitions.js";
import { useTheme } from "./hooks/useTheme.js";
import { useNow } from "./hooks/useNow.js";
import { isClosingSoon, isPast, timeLeft } from "./lib/date.js";
import { CLOSING_SOON_DAYS } from "./lib/constants.js";
import { CalendarIcon, ClockIcon, SparkIcon, StarIcon, TrophyIcon } from "./components/Icons.jsx";

const byDeadline = (a, b) => new Date(a.deadline) - new Date(b.deadline);
const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);

const NO_FILTERS = { category: null, favoritesOnly: false, mode: null, closingSoon: false };

/** Case-insensitive multi-word match: every word must appear somewhere. */
function matchesQuery(c, words) {
  if (!words.length) return true;
  const haystack = [c.title, c.organizer, c.location, c.prize, c.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

function Section({ icon: Icon, title, hint, children }) {
  return (
    <section className="animate-rise">
      <div className="mb-3.5 flex items-baseline gap-2.5">
        <span className="grid h-7 w-7 translate-y-1 place-items-center rounded-lg bg-ink/5 text-ink-soft dark:bg-white/5 dark:text-night-soft">
          <Icon size={15} />
        </span>
        <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
        {hint && <span className="eyebrow translate-y-[-1px]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

const Grid = ({ children }) => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
);

function Stat({ icon: Icon, value, label, accent, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`card flex items-center gap-3 px-4 py-3 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-lift active:scale-[.98] ${
        active ? "ring-2 ring-marigold" : ""
      }`}
      aria-pressed={active}
    >
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${accent}`}>
        <Icon size={17} />
      </span>
      <span className="min-w-0">
        <span
          className="block font-display text-xl font-bold leading-none tracking-tight"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </span>
        <span className="mt-1 block truncate text-[12.5px] font-medium text-ink-soft dark:text-night-soft">
          {label}
        </span>
      </span>
    </button>
  );
}

export default function App() {
  const { competitions, add, update, remove, toggleFavorite } = useCompetitions();
  const { dark, toggle } = useTheme();
  const now = useNow(30000); // coarse clock — only section grouping needs it

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query); // keeps typing snappy on big lists
  const [filters, setFilters] = useState(NO_FILTERS);
  const [detailsId, setDetailsId] = useState(null);
  const [formTarget, setFormTarget] = useState(null); // null | "new" | competition
  const [deleteTarget, setDeleteTarget] = useState(null);

  const filtering =
    Boolean(deferredQuery.trim()) || JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

  const visible = useMemo(() => {
    const words = deferredQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const { category, favoritesOnly, mode, closingSoon } = filters;
    return competitions.filter((c) => {
      if (category && c.category !== category) return false;
      if (favoritesOnly && !c.favorite) return false;
      // "hybrid" counts as both online and offline
      if (mode && c.mode !== mode && c.mode !== "hybrid") return false;
      if (closingSoon && !isClosingSoon(c.deadline, CLOSING_SOON_DAYS, now)) return false;
      return matchesQuery(c, words);
    });
  }, [competitions, deferredQuery, filters, now]);

  const counts = useMemo(() => {
    const map = {};
    for (const c of competitions) map[c.category] = (map[c.category] ?? 0) + 1;
    return map;
  }, [competitions]);

  const stats = useMemo(
    () => ({
      total: competitions.length,
      soon: competitions.filter((c) => isClosingSoon(c.deadline, CLOSING_SOON_DAYS, now)).length,
      favorites: competitions.filter((c) => c.favorite).length,
    }),
    [competitions, now]
  );

  const closingSoon = visible
    .filter((c) => isClosingSoon(c.deadline, CLOSING_SOON_DAYS, now))
    .sort(byDeadline);
  const upcoming = visible
    .filter((c) => timeLeft(c.deadline, now) > CLOSING_SOON_DAYS * 864e5)
    .sort(byDeadline);
  const closed = visible.filter((c) => isPast(c.deadline, now)).sort(byDeadline).reverse();
  const recent = [...visible].sort(byNewest).slice(0, 3);
  const spotlight = [...closingSoon, ...upcoming][0] ?? null;

  const details = competitions.find((c) => c.id === detailsId) ?? null;

  // Stable callbacks so memoized cards don't re-render needlessly.
  const openDetails = useCallback((c) => setDetailsId(c.id), []);
  const openEdit = useCallback((c) => setFormTarget(c), []);
  const askDelete = useCallback((c) => setDeleteTarget(c), []);

  const handleSave = (data) => {
    if (formTarget === "new") {
      const item = add(data);
      setDetailsId(item.id);
    } else {
      update(formTarget.id, data);
      setDetailsId(formTarget.id);
    }
    setFormTarget(null);
  };

  const handleDelete = () => {
    remove(deleteTarget.id);
    setDeleteTarget(null);
    setDetailsId(null);
  };

  const clearFilters = () => {
    setQuery("");
    setFilters(NO_FILTERS);
  };

  let cardIndex = 0;
  const renderCard = (c) => (
    <CompetitionCard
      key={c.id}
      competition={c}
      index={cardIndex++}
      onOpen={openDetails}
      onEdit={openEdit}
      onDelete={askDelete}
      onToggleFavorite={toggleFavorite}
    />
  );

  return (
    <div className="min-h-dvh pb-20">
      <Header
        query={query}
        onQuery={setQuery}
        dark={dark}
        onToggleTheme={toggle}
        onAdd={() => setFormTarget("new")}
      />

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pt-6 sm:px-6 sm:pt-8">
        {!filtering && (
          <Spotlight competition={spotlight} onOpen={openDetails} />
        )}

        {!filtering && competitions.length > 0 && (
          <div className="grid grid-cols-3 gap-3 animate-rise max-sm:-mt-2">
            <Stat
              icon={TrophyIcon}
              value={stats.total}
              label="Tracked"
              accent="bg-ink/5 text-ink-soft dark:bg-white/5 dark:text-night-soft"
              active={false}
              onClick={clearFilters}
            />
            <Stat
              icon={ClockIcon}
              value={stats.soon}
              label="Closing soon"
              accent="bg-ember/10 text-ember"
              active={filters.closingSoon}
              onClick={() => setFilters((f) => ({ ...f, closingSoon: !f.closingSoon }))}
            />
            <Stat
              icon={StarIcon}
              value={stats.favorites}
              label="Favorites"
              accent="bg-marigold/15 text-marigold-deep dark:text-marigold"
              active={filters.favoritesOnly}
              onClick={() => setFilters((f) => ({ ...f, favoritesOnly: !f.favoritesOnly }))}
            />
          </div>
        )}

        <FilterBar filters={filters} onChange={setFilters} counts={counts} />

        {visible.length === 0 ? (
          <EmptyState filtered={filtering} onAdd={() => setFormTarget("new")} onClear={clearFilters} />
        ) : (
          <>
            {closingSoon.length > 0 && (
              <Section icon={ClockIcon} title="Closing soon" hint={`within ${CLOSING_SOON_DAYS} days`}>
                <Grid>{closingSoon.map(renderCard)}</Grid>
              </Section>
            )}

            {upcoming.length > 0 && (
              <Section icon={CalendarIcon} title="Upcoming">
                <Grid>{upcoming.map(renderCard)}</Grid>
              </Section>
            )}

            {!filtering && recent.length > 0 && (
              <Section icon={SparkIcon} title="Recently added">
                <Grid>{recent.map(renderCard)}</Grid>
              </Section>
            )}

            {closed.length > 0 && (
              <Section icon={ClockIcon} title="Closed" hint="past deadlines">
                <Grid>{closed.map(renderCard)}</Grid>
              </Section>
            )}
          </>
        )}
      </main>

      <footer className="safe-bottom mx-auto max-w-6xl px-4 pt-16 text-center sm:px-6">
        <p className="font-display text-[15px] font-bold tracking-tight text-ink-faint dark:text-night-soft/70">
          Compete
        </p>
        <p className="mt-1 text-[12.5px] text-ink-faint/80 dark:text-night-soft/50">
          Your deadlines, all in one place · data stays on this device
        </p>
      </footer>

      {details && !formTarget && (
        <CompetitionDetails
          competition={details}
          onClose={() => setDetailsId(null)}
          onEdit={openEdit}
          onDelete={askDelete}
          onToggleFavorite={toggleFavorite}
        />
      )}

      {formTarget && (
        <CompetitionForm
          initial={formTarget === "new" ? null : formTarget}
          onSave={handleSave}
          onClose={() => setFormTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete competition"
          message={`"${deleteTarget.title}" will be removed from your list. This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
