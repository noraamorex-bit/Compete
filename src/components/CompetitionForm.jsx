import { useState } from "react";
import Modal from "./Modal.jsx";
import { CATEGORIES, MODES } from "../lib/constants.js";
import { toLocalInputValue } from "../lib/date.js";

const empty = {
  title: "",
  organizer: "",
  category: "olympiad",
  deadline: "",
  website: "",
  registrationLink: "",
  mode: "online",
  location: "",
  prize: "",
  notes: "",
};

export default function CompetitionForm({ initial, onSave, onClose }) {
  const editing = Boolean(initial);
  const [form, setForm] = useState(() =>
    initial
      ? { ...initial, deadline: toLocalInputValue(initial.deadline) }
      : { ...empty, deadline: "" }
  );
  const [errors, setErrors] = useState({});

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    const next = {};
    if (!form.title.trim()) next.title = "Give the competition a name.";
    if (!form.deadline) next.deadline = "Pick the registration deadline.";
    if (form.mode !== "online" && !form.location.trim())
      next.location = "Add a city or venue for offline events.";
    setErrors(next);
    if (Object.keys(next).length) return;

    onSave({
      ...form,
      title: form.title.trim(),
      organizer: form.organizer.trim(),
      location: form.location.trim(),
      prize: form.prize.trim(),
      notes: form.notes.trim(),
      deadline: new Date(form.deadline).toISOString(),
    });
  };

  const err = (key) =>
    errors[key] ? <p className="mt-1 text-[12.5px] font-medium text-ember">{errors[key]}</p> : null;

  return (
    <Modal title={editing ? "Edit competition" : "Add competition"} onClose={onClose} wide>
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="f-title">Title</label>
          <input id="f-title" className="field" value={form.title} onChange={set("title")}
            placeholder="e.g. International Astronomy Olympiad" autoFocus />
          {err("title")}
        </div>

        <div>
          <label className="field-label" htmlFor="f-org">Organizer</label>
          <input id="f-org" className="field" value={form.organizer} onChange={set("organizer")}
            placeholder="e.g. IAPT" />
        </div>

        <div>
          <label className="field-label" htmlFor="f-cat">Category</label>
          <select id="f-cat" className="field-select" value={form.category} onChange={set("category")}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="f-deadline">Registration deadline</label>
          <input id="f-deadline" type="datetime-local" className="field"
            value={form.deadline} onChange={set("deadline")} />
          {err("deadline")}
        </div>

        <div>
          <label className="field-label">Format</label>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-mist p-1 dark:bg-night/70">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setForm((f) => ({ ...f, mode: m.id }))}
                className={`rounded-lg px-2 py-2 text-[13.5px] font-semibold transition ${
                  form.mode === m.id
                    ? "bg-paper text-ink shadow-card dark:bg-night-card dark:text-night-text"
                    : "text-ink-soft hover:text-ink dark:text-night-soft dark:hover:text-night-text"
                }`}
                aria-pressed={form.mode === m.id}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {form.mode !== "online" && (
          <div className="sm:col-span-2">
            <label className="field-label" htmlFor="f-loc">Location</label>
            <input id="f-loc" className="field" value={form.location} onChange={set("location")}
              placeholder="e.g. IIT Bombay, Mumbai" />
            {err("location")}
          </div>
        )}

        <div>
          <label className="field-label" htmlFor="f-web">Official website</label>
          <input id="f-web" type="url" className="field" value={form.website} onChange={set("website")}
            placeholder="https://" />
        </div>

        <div>
          <label className="field-label" htmlFor="f-reg">Registration link</label>
          <input id="f-reg" type="url" className="field" value={form.registrationLink}
            onChange={set("registrationLink")} placeholder="https://" />
        </div>

        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="f-prize">Prize</label>
          <input id="f-prize" className="field" value={form.prize} onChange={set("prize")}
            placeholder="e.g. ₹50,000 + national camp selection" />
        </div>

        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="f-notes">Notes</label>
          <textarea id="f-notes" className="field min-h-[88px] resize-y" value={form.notes}
            onChange={set("notes")} placeholder="Eligibility, documents, team size, reminders to self…" />
        </div>

        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" onClick={onClose} className="btn-quiet">Cancel</button>
          <button type="submit" className="btn-primary">
            {editing ? "Save changes" : "Add competition"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
