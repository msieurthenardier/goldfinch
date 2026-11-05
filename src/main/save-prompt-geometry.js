// @ts-check
'use strict';

// Pure bounds helper for the floating save-prompt WebContentsView (Sortie 06, DD1). The find
// overlay's twin (`find-overlay-geometry.js`): a content-sized card anchored to the TOP-RIGHT of
// the active guest, hanging from the vault toolbar indicator when the chrome measured one.
// Electron-free; bounds are DIP end-to-end (no DPR math here).

const SAVE_PROMPT_WIDTH = 340; // DIP; clamped to guest width - 16
const SAVE_PROMPT_MIN_HEIGHT = 80;
const SAVE_PROMPT_MARGIN = 8; // DIP minimum inset from every guest edge
const SAVE_PROMPT_MARGIN_RIGHT = 12; // DIP inset used when there is no anchor
const SAVE_PROMPT_FIND_OFFSET = 56; // find bar (48) + 8 gap, when the find overlay is visible

/**
 * @param {{
 *   guest: { x: number, y: number, width: number, height: number },
 *   anchorRightDip?: number | null,
 *   findVisible?: boolean,
 *   contentHeight: number
 * }} args
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function computeSavePromptBounds({ guest, anchorRightDip, findVisible, contentHeight }) {
  const width = Math.min(SAVE_PROMPT_WIDTH, guest.width - 2 * SAVE_PROMPT_MARGIN);
  const maxHeight = guest.height - 2 * SAVE_PROMPT_MARGIN;
  const wanted = Number.isFinite(contentHeight) ? contentHeight : SAVE_PROMPT_MIN_HEIGHT;
  const height = Math.max(Math.min(wanted, maxHeight), Math.min(SAVE_PROMPT_MIN_HEIGHT, maxHeight));
  const y = guest.y + SAVE_PROMPT_MARGIN + (findVisible ? SAVE_PROMPT_FIND_OFFSET : 0);
  const right =
    typeof anchorRightDip === 'number' && Number.isFinite(anchorRightDip) && anchorRightDip > 0
      ? anchorRightDip
      : guest.x + guest.width - SAVE_PROMPT_MARGIN_RIGHT;
  const minX = guest.x + SAVE_PROMPT_MARGIN;
  const maxX = guest.x + guest.width - SAVE_PROMPT_MARGIN - width;
  const x = Math.max(minX, Math.min(right - width, maxX));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

module.exports = {
  computeSavePromptBounds,
  SAVE_PROMPT_WIDTH,
  SAVE_PROMPT_MIN_HEIGHT,
  SAVE_PROMPT_MARGIN,
  SAVE_PROMPT_MARGIN_RIGHT,
  SAVE_PROMPT_FIND_OFFSET
};
