// NERV telemetry toast — context + hook. Kept separate from ToastProvider
// so the component file stays react-refresh clean (hook and component
// exports must not share a file).

import { createContext, useContext } from "react";

export type ToastVariant = "info" | "success" | "warning" | "error" | "critical";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  /** Auto-dismiss delay in ms (default: 3000). */
  duration: number;
}

export interface AddToastPayload {
  message: string;
  variant: ToastVariant;
  duration?: number;
}

export interface ToastContextValue {
  addToast: (t: AddToastPayload) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

/** Fire a toast. Must be used inside `<ToastProvider>` (see main.tsx). */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
