"use client";

import { useEffect } from "react";

export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-scrim px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        className="dialog-in w-full max-w-[400px] rounded-2xl border border-line bg-panel p-5 shadow-dialog"
      >
        <h2 id="confirm-title" className="text-base font-semibold text-fg">
          {request.title}
        </h2>
        <p id="confirm-description" className="mt-2 text-sm leading-6 text-muted">
          {request.description}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="h-9 rounded-full border border-line px-4 text-sm font-medium text-fg transition-colors hover:bg-ink/[0.06]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              request.onConfirm();
              onClose();
            }}
            className="h-9 rounded-full bg-red-500/90 px-4 text-sm font-medium text-white transition-colors hover:bg-red-500"
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
