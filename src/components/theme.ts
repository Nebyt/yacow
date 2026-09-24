import { RGBA } from '@opentui/core';

/**
 * The terminal's own foreground (SGR 39), not a literal white. Text that has no
 * colour of its own must use this: a hardcoded `#FFFFFF` disappears on a light
 * terminal theme, and OpenTUI's `<text>` default is exactly that white.
 */
export const FG = RGBA.defaultForeground();

/** Secondary text: hints, labels, dimmed rows. Mid-tone, legible on both themes. */
export const MUTED = '#9ca3af';

/** Selection / focus accent, matching the header rule. */
export const ACCENT = '#3b82f6';
export const BORDER = '#6b7280';

/** Semantic colours shared by messages and fixed-meaning values. */
export const ERROR = '#ef4444';
export const SUCCESS = '#22c55e';
export const INFO = '#22d3ee';
export const WARNING = '#eab308';
