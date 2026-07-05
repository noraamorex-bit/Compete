import { useNow } from "../hooks/useNow.js";
import { formatCountdown, formatDeadline } from "../lib/date.js";
import { categoryById } from "../lib/constants.js";
import { ClockIcon } from "./Icons.jsx";

/**
 * The hero: the single next deadline, front and centre,
 * with a live monospace countdown. Ticks on its own clock so the
 * rest of the dashboard doesn't re-render every second.
 */
export default function Spotlight({ competition, onOpen }) {
  const now = useNow(1000);
  if (!competition) return null;
  const cat = categoryById(competition.category);

  return (
    <section className="animate-rise">
      <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#1B2450] via-[#232E66] to-[#141B3D] p-6 text-white shadow-lift transition duration-300 hover:shadow-modal sm:p-8">
        {/* soft glows */}
        <div className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-marigold/25 blur-3xl transition duration-500 group-hover:bg-marigold/35" />
        <div className="pointer-events-none absolute -bottom-40 -left-16 h-72 w-72 rounded-full bg-[#556AF0]/20 blur-3xl" />

        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <button onClick={() => onOpen(competition)} className="min-w-0 text-left">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/80">
              <ClockIcon size={14} /> Next deadline
            </p>
            <h2 className="truncate font-display text-2xl font-bold leading-tight underline-offset-4 transition group-hover:underline sm:text-[32px]">
              {competition.title}
            </h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[15px] text-white/70">
              <span>{competition.organizer}</span>
              <span className="opacity-40">·</span>
              <span className="inline-flex items-center gap-1.5">
                <i className="h-2 w-2 rounded-full" style={{ background: cat.dot }} />
                {cat.label}
              </span>
            </p>
          </button>

          <div className="shrink-0 sm:text-right">
            <p
              className="font-mono text-[34px] font-semibold leading-none tracking-tight text-marigold sm:text-[40px]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {formatCountdown(competition.deadline, now)}
            </p>
            <p className="mt-2 text-[13px] text-white/60">
              Closes {formatDeadline(competition.deadline)}
            </p>
            {competition.registrationLink && (
              <a
                href={competition.registrationLink}
                target="_blank"
                rel="noreferrer"
                className="btn mt-3.5 hidden bg-white/10 !py-2 text-white ring-1 ring-white/20 backdrop-blur hover:bg-white/20 sm:inline-flex"
              >
                Register now
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
