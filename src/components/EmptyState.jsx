import { InboxIcon, PlusIcon } from "./Icons.jsx";

export default function EmptyState({ filtered, onAdd, onClear }) {
  return (
    <div className="card flex flex-col items-center px-6 py-16 text-center animate-rise">
      <span className="relative grid h-16 w-16 place-items-center rounded-2xl bg-mist text-ink-faint ring-1 ring-ink/5 dark:bg-night/70 dark:text-night-soft dark:ring-night-edge">
        <span className="pointer-events-none absolute -inset-4 -z-10 rounded-full bg-marigold/10 blur-2xl" aria-hidden="true" />
        <InboxIcon size={28} />
      </span>
      <h3 className="mt-4 font-display text-xl font-bold tracking-tight">
        {filtered ? "Nothing matches" : "No competitions yet"}
      </h3>
      <p className="mt-1.5 max-w-sm text-[15px] text-ink-soft dark:text-night-soft">
        {filtered
          ? "Try a different search or clear the filters."
          : "Found something interesting online? Save it here and the deadline takes care of itself."}
      </p>
      {filtered ? (
        <button onClick={onClear} className="btn-quiet mt-6">Clear filters</button>
      ) : (
        <button onClick={onAdd} className="btn-primary mt-6">
          <PlusIcon size={17} /> Add your first competition
        </button>
      )}
    </div>
  );
}
