// NERV "system response" motion tokens. The aesthetic is a MAGI control
// room, not a consumer app: sharp mechanical in-out curves, short
// durations, exits ≈ 60–70% of enters. Long/soft/bouncy transitions read
// playful and fight the terminal theme — if a new animation doesn't fit
// these tokens, it probably doesn't belong in the app.
//
// Rules enforced here (from the "cheap motion" checklist):
//  - no default/linear easing except very short opacity-only fades
//  - vary the axis by spatial logic, not a one-size opacity+scale template
//  - springs only for direct interaction (pan/zoom), tweens for state changes
//  - transform + opacity only — never width/height/top/left/box-shadow

/** Hard mechanical in-out — a machine settling, not an app easing in. */
export const EASE_MECHANICAL: [number, number, number, number] = [0.83, 0, 0.17, 1];

/** Full-screen overlays (modal backdrops, viewer takeover): fade only. */
export const OVERLAY_ENTER = { duration: 0.14, ease: EASE_MECHANICAL };
export const OVERLAY_EXIT = { duration: 0.09, ease: EASE_MECHANICAL };

/** Modal panels: fade + drop, settling slightly larger (1.02 → 1). */
export const PANEL_ENTER = { duration: 0.16, ease: EASE_MECHANICAL };
export const PANEL_EXIT = { duration: 0.1, ease: EASE_MECHANICAL };
