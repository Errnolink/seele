// Monospace terminal display — ported from @mdrbx/nerv-ui (MIT) and adapted
// to Seele's palette + motion tokens. Used by AnalyticsModal to present the
// storage summary as a MAGI-style boot log.
//
// Adaptations vs upstream:
//  - tokens remapped (nerv-black→nerv-bg, nerv-mid-gray→nerv-border-highlight,
//    nerv-dark-gray→nerv-panel-2, nerv-mid-gray text→nerv-muted)
//  - font vars → Seele's --font-display / --font-mono
//  - motion/react instead of framer-motion
//  - the `nerv-text-shadow-*` glow classes don't exist in Seele and were
//    dropped — text-shadow bloom is against the app's subdued-effects rule

import { forwardRef, useEffect, useRef, useState, type HTMLAttributes } from "react";
import { motion } from "motion/react";

export interface TerminalDisplayProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "className" | "color"> {
  /** Lines of text to display */
  lines: string[];
  /** Enable typewriter effect */
  typewriter?: boolean;
  /** Typing speed in ms per character */
  typeSpeed?: number;
  /** Delay between lines in ms */
  lineDelay?: number;
  /** Text color variant */
  color?: "green" | "orange" | "cyan" | "red";
  /** Show the blinking cursor */
  showCursor?: boolean;
  /** Terminal title/label */
  title?: string;
  /** Max height with scroll */
  maxHeight?: string;
  /** Optional className */
  className?: string;
  /** Show line numbers */
  showLineNumbers?: boolean;
  /** Prefix each line with a prompt symbol */
  prompt?: string;
}

const colorMap = {
  green: "text-nerv-green",
  orange: "text-nerv-orange",
  cyan: "text-nerv-cyan",
  red: "text-nerv-red",
};

const lineNumberMap = {
  green: "text-nerv-green/72 border-nerv-green/18 bg-nerv-green/[0.05]",
  orange: "text-nerv-orange/75 border-nerv-orange/22 bg-nerv-orange/[0.05]",
  cyan: "text-nerv-cyan/75 border-nerv-cyan/22 bg-nerv-cyan/[0.05]",
  red: "text-nerv-red/78 border-nerv-red/22 bg-nerv-red/[0.05]",
};

export const TerminalDisplay = forwardRef<HTMLDivElement, TerminalDisplayProps>(
  function TerminalDisplay(
    {
      lines,
      typewriter = false,
      typeSpeed = 30,
      lineDelay = 200,
      color = "green",
      showCursor = true,
      title,
      maxHeight = "400px",
      className = "",
      showLineNumbers = false,
      prompt,
      ...rest
    },
    ref,
  ) {
    const [displayedLines, setDisplayedLines] = useState<string[]>(typewriter ? [] : lines);
    const [currentLine, setCurrentLine] = useState(0);
    const [currentChar, setCurrentChar] = useState(0);
    const [isTyping, setIsTyping] = useState(typewriter);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      setDisplayedLines(typewriter ? [] : lines);
      setCurrentLine(0);
      setCurrentChar(0);
      setIsTyping(typewriter);
    }, [lines, typewriter, typeSpeed, lineDelay]);

    // Typewriter effect
    useEffect(() => {
      if (!typewriter || currentLine >= lines.length) {
        setIsTyping(false);
        return;
      }

      const line = lines[currentLine];

      if (currentChar === 0) {
        setDisplayedLines((prev) => [...prev, ""]);
      }

      if (currentChar < line.length) {
        const timeout = setTimeout(() => {
          setDisplayedLines((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = line.substring(0, currentChar + 1);
            return updated;
          });
          setCurrentChar((c) => c + 1);
        }, typeSpeed);
        return () => clearTimeout(timeout);
      }

      const timeout = setTimeout(() => {
        setCurrentLine((l) => l + 1);
        setCurrentChar(0);
      }, lineDelay);
      return () => clearTimeout(timeout);
    }, [typewriter, currentLine, currentChar, lines, typeSpeed, lineDelay]);

    // Auto-scroll to bottom
    useEffect(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }, [displayedLines]);

    const textColor = colorMap[color];
    const lineNumberClass = lineNumberMap[color];

    return (
      <div ref={ref} className={`relative border border-nerv-border-highlight bg-nerv-bg ${className}`} {...rest}>
        {/* Terminal header */}
        {title && (
          <div className="flex items-center gap-2 border-b border-nerv-border-highlight bg-nerv-panel-2 px-3 py-1.5">
            <div className="flex gap-1.5">
              <div className="h-2 w-2 bg-nerv-red" />
              <div className="h-2 w-2 bg-nerv-orange" />
              <div className="h-2 w-2 bg-nerv-green" />
            </div>
            <span className="ml-2 text-xs font-bold uppercase tracking-[0.2em] text-nerv-orange" style={{ fontFamily: "var(--font-display)" }}>
              {title}
            </span>
            <div className="ml-auto font-mono text-[10px] text-nerv-muted">MAGI_SYS</div>
          </div>
        )}

        {/* Terminal body */}
        <div
          ref={containerRef}
          className="overflow-y-auto p-4 font-mono text-sm leading-relaxed"
          style={{ maxHeight, fontFamily: "var(--font-mono)" }}
        >
          {displayedLines.map((line, i) => (
            <motion.div
              key={i}
              initial={typewriter ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              className={`${textColor} whitespace-pre-wrap`}
            >
              {showLineNumbers && (
                <span
                  data-slot="line-number"
                  className={`mr-3 inline-flex w-12 shrink-0 select-none items-center justify-end border-r pr-2 text-[11px] font-semibold tabular-nums ${lineNumberClass}`}
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {String(i + 1).padStart(3, "0")}
                </span>
              )}
              {prompt && <span className="mr-1 select-none text-nerv-orange">{prompt}</span>}
              {line}
              {/* Cursor on current typing line */}
              {showCursor && isTyping && i === displayedLines.length - 1 && (
                <span className="ml-0.5 inline-block h-4 w-2.5 bg-current align-middle" style={{ animation: "cursor-blink 1s step-end infinite" }} />
              )}
            </motion.div>
          ))}

          {/* Resting cursor when typing is done */}
          {showCursor && !isTyping && (
            <span
              className={`ml-0.5 inline-block h-4 w-2.5 align-middle ${textColor.replace("text-", "bg-")}`}
              style={{ animation: "cursor-blink 1s step-end infinite" }}
            />
          )}
        </div>

        {/* Bottom status bar */}
        <div className="flex items-center justify-between border-t border-nerv-border-highlight bg-nerv-panel-2 px-3 py-1 font-mono text-[10px] text-nerv-muted">
          <span>LINES: {displayedLines.length}</span>
          <span>{isTyping ? "TRANSMITTING..." : "READY"}</span>
        </div>
      </div>
    );
  },
);
