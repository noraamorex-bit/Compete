import Modal from "./Modal.jsx";
import Countdown from "./Countdown.jsx";
import { categoryById } from "../lib/constants.js";
import { formatDeadline, isPast } from "../lib/date.js";
import {
  CalendarIcon, GlobeIcon, LinkIcon, PencilIcon, PinIcon,
  StarIcon, TrashIcon, TrophyIcon,
} from "./Icons.jsx";

const Row = ({ icon: Icon, label, children }) => (
  <div className="flex items-start gap-3 py-3">
    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-mist text-ink-soft dark:bg-night/70 dark:text-night-soft">
      <Icon size={16} />
    </span>
    <div className="min-w-0">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint dark:text-night-soft/70">
        {label}
      </p>
      <div className="mt-0.5 text-[15px]">{children}</div>
    </div>
  </div>
);

const ExtLink = ({ href }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="break-all font-medium text-marigold-deep underline decoration-marigold/40 underline-offset-2 hover:decoration-marigold dark:text-marigold"
  >
    {href.replace(/^https?:\/\//, "")}
  </a>
);

export default function CompetitionDetails({
  competition: c, onClose, onEdit, onDelete, onToggleFavorite,
}) {
  const cat = categoryById(c.category);
  const past = isPast(c.deadline);
  const modeLabel = { online: "Online", offline: "Offline", hybrid: "Hybrid" }[c.mode];

  return (
    <Modal title="Details" onClose={onClose} wide>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
            style={{ background: `${cat.dot}1a`, color: cat.dot }}
          >
            <i className="h-1.5 w-1.5 rounded-full" style={{ background: cat.dot }} />
            {cat.label}
          </span>
          <h3 className="mt-2.5 font-display text-2xl font-bold leading-tight tracking-tight">
            {c.title}
          </h3>
          {c.organizer && (
            <p className="mt-1 text-[15px] text-ink-soft dark:text-night-soft">{c.organizer}</p>
          )}
        </div>
        <button
          onClick={() => onToggleFavorite(c.id)}
          className={`shrink-0 rounded-full p-2.5 transition ${
            c.favorite
              ? "bg-marigold/15 text-marigold"
              : "text-ink-faint hover:bg-ink/5 hover:text-marigold dark:text-night-soft dark:hover:bg-white/5"
          }`}
          aria-label={c.favorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={c.favorite}
        >
          <StarIcon size={20} filled={c.favorite} />
        </button>
      </div>

      <div className="mt-5 divide-y divide-ink/5 dark:divide-night-edge">
        <Row icon={CalendarIcon} label="Deadline">
          <div className="flex flex-wrap items-center gap-2">
            <span className={past ? "text-ink-faint line-through dark:text-night-soft/70" : ""}>
              {formatDeadline(c.deadline)}
            </span>
            <Countdown deadline={c.deadline} />
          </div>
        </Row>

        <Row icon={c.mode === "online" ? GlobeIcon : PinIcon} label="Format">
          {modeLabel}
          {c.location && ` · ${c.location}`}
        </Row>

        {c.prize && (
          <Row icon={TrophyIcon} label="Prize">{c.prize}</Row>
        )}

        {c.website && (
          <Row icon={GlobeIcon} label="Official website"><ExtLink href={c.website} /></Row>
        )}

        {c.registrationLink && (
          <Row icon={LinkIcon} label="Registration"><ExtLink href={c.registrationLink} /></Row>
        )}

        {c.notes && (
          <div className="py-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-faint dark:text-night-soft/70">
              Notes
            </p>
            <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-soft dark:text-night-soft">
              {c.notes}
            </p>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-ink/5 pt-5 dark:border-night-edge">
        <button
          onClick={() => onDelete(c)}
          className="btn-ghost !px-3 text-ember hover:!bg-ember/10"
        >
          <TrashIcon size={17} /> Delete
        </button>
        <div className="flex gap-2">
          <button onClick={() => onEdit(c)} className="btn-quiet">
            <PencilIcon size={16} /> Edit
          </button>
          {c.registrationLink && !past && (
            <a href={c.registrationLink} target="_blank" rel="noreferrer" className="btn-primary">
              Register now
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
}
