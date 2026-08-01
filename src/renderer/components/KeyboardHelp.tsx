import { useEffect } from "react";

export interface ShortcutEntry {
  keys: string[];
  label: string;
}

const SHORTCUTS: { section: string; entries: ShortcutEntry[] }[] = [
  {
    section: "Navigation",
    entries: [
      { keys: ["Ctrl", "O"], label: "Open folder" },
      { keys: ["Ctrl", "Enter"], label: "Start scan" },
      { keys: ["Esc"], label: "Close viewer / clear search / clear folder" },
      { keys: ["←", "→"], label: "Previous / next in viewer" },
      { keys: ["R"], label: "Reload failed thumbnails" },
    ],
  },
  {
    section: "View",
    entries: [
      { keys: ["Ctrl", "F"], label: "Focus search" },
      { keys: ["?"], label: "Toggle this help" },
    ],
  },
];

interface KeyboardHelpProps {
  onClose: () => void;
}

export const KeyboardHelp: React.FC<KeyboardHelpProps> = ({ onClose }) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-nerv-bg/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-[420px] bg-nerv-panel border border-nerv-border bg-opacity-90 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-10 border-b border-nerv-border/60 bg-nerv-panel-2">
          <span className="font-display text-xs uppercase tracking-widest text-nerv-amber font-bold">
            Keyboard Shortcuts
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-nerv-muted hover:text-nerv-orange text-xs"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {SHORTCUTS.map((group) => (
            <div key={group.section}>
              <div className="text-[10px] uppercase tracking-widest text-nerv-muted font-bold mb-2">
                {group.section}
              </div>
              <div className="space-y-1.5">
                {group.entries.map((entry) => (
                  <div
                    key={entry.label}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-nerv-text/80">{entry.label}</span>
                    <div className="flex items-center gap-1">
                      {entry.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          <kbd className="px-1.5 py-0.5 border border-nerv-orange/40 bg-nerv-panel-2 text-nerv-orange text-[10px] font-mono">
                            {k}
                          </kbd>
                          {i < entry.keys.length - 1 && (
                            <span className="text-nerv-muted text-[10px]">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-nerv-border/40 text-[10px] text-nerv-muted/60 text-center">
          Press <span className="text-nerv-orange">Esc</span> to close
        </div>
      </div>
    </div>
  );
};

export default KeyboardHelp;
