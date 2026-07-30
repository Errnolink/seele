import React, { useState, useEffect, useRef } from "react";

export interface BootSequenceProps {
  durationMs?: number;
  onDone?: () => void;
}

/**
 * Full-screen tactical boot animation shown once on app mount. Skipped
 * entirely in dev mode (durationMs === 0) so HMR reloads don't block
 * interaction on every reload (review issue #26).
 *
 * `onDone` is stored in a ref so a non-memoized parent callback doesn't
 * re-trigger the timer on every render (v4 review M-8).
 */
export const BootSequence: React.FC<BootSequenceProps> = ({
  durationMs = 500,
  onDone,
}) => {
  const [done, setDone] = useState(durationMs === 0);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (durationMs === 0) {
      onDoneRef.current?.();
      return;
    }
    const timer = setTimeout(() => {
      setDone(true);
      onDoneRef.current?.();
    }, durationMs);

    return () => clearTimeout(timer);
  }, [durationMs]);

  if (done) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 pointer-events-none bg-nerv-bg flex items-center justify-center overflow-hidden">
      {/* Scanline bar sweeping down */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-nerv-orange/20 to-transparent animate-scanline" />

      {/* Tactical boot glitch center text */}
      <div className="relative z-10 animate-boot-glitch text-center">
        <h1 className="font-display text-xl sm:text-2xl text-nerv-orange tracking-widest uppercase font-bold">
          NERV-MAGI // INITIALIZING
        </h1>
      </div>
    </div>
  );
};

export default BootSequence;
