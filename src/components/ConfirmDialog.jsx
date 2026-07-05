import Modal from "./Modal.jsx";

export default function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-[15px] leading-relaxed text-ink-soft dark:text-night-soft">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onCancel} className="btn-quiet">
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="btn bg-ember text-white shadow-[0_6px_16px_-6px_rgba(229,72,77,.5)] hover:brightness-105"
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
