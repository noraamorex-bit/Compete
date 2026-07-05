import { useEffect } from "react";
import { CloseIcon } from "./Icons.jsx";

export default function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-[6px] animate-fade dark:bg-black/60 sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`card safe-bottom w-full ${
          wide ? "sm:max-w-2xl" : "sm:max-w-lg"
        } max-h-[92dvh] overflow-y-auto !rounded-b-none !rounded-t-[28px] border-0 shadow-modal animate-sheet sm:max-h-[88dvh] sm:animate-pop sm:!rounded-3xl sm:border sm:pb-0`}
      >
        {/* grab handle — bottom sheet affordance on phones */}
        <div className="sticky top-0 z-10 border-b border-ink/5 bg-paper/90 backdrop-blur dark:border-night-edge dark:bg-night-card/90">
          <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-ink/15 dark:bg-white/20 sm:hidden" aria-hidden="true" />
          <div className="flex items-center justify-between px-6 py-3.5">
            <h2 className="font-display text-lg font-bold tracking-tight">{title}</h2>
            <button onClick={onClose} className="icon-btn -mr-2" aria-label="Close">
              <CloseIcon size={18} />
            </button>
          </div>
        </div>
        <div className="p-6 pt-5">{children}</div>
      </div>
    </div>
  );
}
