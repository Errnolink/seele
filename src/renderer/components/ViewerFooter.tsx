/**
 * ViewerFooter — keyboard-hint bar pinned below the filmstrip.
 */
import React, { memo } from "react";

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] text-nerv-muted">
      <kbd className="border border-nerv-orange/40 px-1.5 py-0.5 text-[8px] font-bold text-nerv-orange">
        {keys}
      </kbd>
      <span className="uppercase tracking-wider">{label}</span>
    </span>
  );
}

function HintDivider() {
  return <span className="h-3 w-px bg-nerv-border/60" />;
}

export interface ViewerFooterProps {
  isVideo: boolean;
}

export const ViewerFooter: React.FC<ViewerFooterProps> = memo(
  ({ isVideo }) => (
    <div className="relative z-20 flex-shrink-0 border-t border-nerv-orange/20 bg-nerv-panel/90 px-4 py-1.5">
      <div className="flex items-center justify-center gap-3">
        <Hint keys="←/→" label="Navigate" />
        <HintDivider />
        {!isVideo && <Hint keys="+/-/0" label="Zoom" />}
        {!isVideo && <HintDivider />}
        <Hint keys="I" label="Info" />
        <HintDivider />
        <Hint keys="Del" label="Queue Trash" />
        <HintDivider />
        <Hint keys="Esc" label="Close" />
      </div>
    </div>
  ),
);
ViewerFooter.displayName = "ViewerFooter";
