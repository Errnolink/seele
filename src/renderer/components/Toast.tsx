// NERV telemetry toasts — ported from @mdrbx/nerv-ui (MIT) and adapted to
// Seele's palette + motion tokens. Fills the app's one real feedback gap:
// move/rename/trash/favorite actions were silent.
//
// Adaptations vs upstream:
//  - tokens remapped to Seele's theme (nerv-cyan/green/orange/red/magenta,
//    nerv-panel, nerv-border-highlight) instead of nerv-ui's aliases
//  - motion/react instead of framer-motion; EASE_MECHANICAL + fast
//    durations per the cheap-motion checklist (enter 0.16 / exit 0.1)
//  - auto-dismiss progress uses scaleX (GPU-composited) not width
//  - the 3% scanline decoration was dropped — invisible detail, and the
//    user asked for subdued effects

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { EASE_MECHANICAL } from "../motion";
import { ToastContext, type AddToastPayload, type Toast, type ToastVariant } from "./useToast";

// ─── Provider ──────────────────────────────────────────────────────────

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((payload: AddToastPayload) => {
    const id = `toast-${Date.now()}-${++counter}`;
    setToasts((prev) => [
      ...prev,
      {
        id,
        message: payload.message,
        variant: payload.variant,
        duration: payload.duration ?? 3000,
      },
    ]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

// ─── Variant config — mapped onto Seele's palette ──────────────────────

const VARIANT_CONFIG: Record<
  ToastVariant,
  { prefix: string; text: string; border: string; bar: string }
> = {
  info: {
    prefix: "[SYS]",
    text: "text-nerv-cyan",
    border: "border-l-nerv-cyan",
    bar: "rgba(32,240,255,0.6)",
  },
  success: {
    prefix: "[OK]",
    text: "text-nerv-green",
    border: "border-l-nerv-green",
    bar: "rgba(80,255,80,0.6)",
  },
  warning: {
    prefix: "[WARN]",
    text: "text-nerv-orange",
    border: "border-l-nerv-orange",
    bar: "rgba(255,152,48,0.6)",
  },
  error: {
    prefix: "[ERR]",
    text: "text-nerv-red",
    border: "border-l-nerv-red",
    bar: "rgba(255,48,48,0.6)",
  },
  critical: {
    prefix: "[CRITICAL]",
    text: "text-nerv-magenta",
    border: "border-l-nerv-magenta",
    bar: "rgba(255,79,216,0.6)",
  },
};

// ─── Toast card ────────────────────────────────────────────────────────

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const config = VARIANT_CONFIG[toast.variant];

  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(timer);
  }, [toast.duration, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16, transition: { duration: 0.1, ease: EASE_MECHANICAL } }}
      transition={{ duration: 0.16, ease: EASE_MECHANICAL }}
      className={`pointer-events-auto relative w-80 max-w-[80vw] cursor-pointer select-none border border-nerv-border-highlight border-l-2 ${config.border} bg-nerv-panel px-4 py-2.5 font-mono`}
      style={{ boxShadow: "0 0 10px rgba(0,0,0,0.5)" }}
      onClick={onDismiss}
      title="Dismiss"
    >
      <div className="flex items-start gap-2">
        <span className={`${config.text} mt-0.5 shrink-0 text-[9px] font-bold tracking-wider opacity-70`}>
          {config.prefix}
        </span>
        <span className={`${config.text} break-words text-[11px] leading-relaxed`}>
          {toast.message}
        </span>
      </div>
      {/* Auto-dismiss countdown — scaleX is GPU-composited (no layout). */}
      <motion.div
        className="absolute bottom-0 left-0 h-[2px] w-full origin-left"
        style={{ backgroundColor: config.bar }}
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: toast.duration / 1000, ease: "linear" }}
      />
    </motion.div>
  );
}

// ─── Container — bottom-right, above the viewer (z-50) ─────────────────

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  const content = (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2">
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  );

  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}
