/**
 * Favicon Badge Overlay — canvas-based favicon badge for browser tab identification.
 *
 * Creates a 32x32 canvas, draws the existing favicon, overlays a colored dot (8px, bottom-right).
 * Replaces the page's <link rel="icon"> with the canvas data URL.
 * Restores original on task completion.
 *
 * Opt-in only (default: false) due to CORS on cross-origin favicons.
 */

let originalFaviconHref: string | undefined;
let originalFaviconEl: HTMLLinkElement | null = null;
let badgeActive = false;

const BADGE_SIZE = 32;
const DOT_RADIUS = 4;
const DOT_COLOR = '#6b6bff';

function getExistingFavicon(): HTMLLinkElement | null {
  return document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
}

function createFaviconLink(): HTMLLinkElement {
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  document.head.appendChild(link);
  return link;
}

/**
 * Apply a badge overlay to the page favicon.
 * Returns true if successful, false if CORS or other issues prevented it.
 */
export function applyFaviconBadge(color = DOT_COLOR): boolean {
  if (badgeActive) return true;

  try {
    const existing = getExistingFavicon();
    if (existing) {
      originalFaviconHref = existing.href;
      originalFaviconEl = existing;
    }

    const canvas = document.createElement('canvas');
    canvas.width = BADGE_SIZE;
    canvas.height = BADGE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      ctx.drawImage(img, 0, 0, BADGE_SIZE, BADGE_SIZE);

      // Draw badge dot
      ctx.beginPath();
      ctx.arc(BADGE_SIZE - DOT_RADIUS - 1, BADGE_SIZE - DOT_RADIUS - 1, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 1;
      ctx.stroke();

      const dataUrl = canvas.toDataURL('image/png');
      const link = existing || createFaviconLink();
      link.href = dataUrl;
      badgeActive = true;
    };

    img.onerror = () => {
      // Can't load favicon (CORS) — draw just the dot on blank
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, BADGE_SIZE, BADGE_SIZE);

      // Draw "R" letter
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('R', BADGE_SIZE / 2, BADGE_SIZE / 2);

      // Draw badge dot
      ctx.beginPath();
      ctx.arc(BADGE_SIZE - DOT_RADIUS - 1, BADGE_SIZE - DOT_RADIUS - 1, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      const dataUrl = canvas.toDataURL('image/png');
      const link = existing || createFaviconLink();
      link.href = dataUrl;
      badgeActive = true;
    };

    if (originalFaviconHref) {
      img.src = originalFaviconHref;
    } else {
      // No existing favicon — trigger error path to draw fallback
      img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAIBAAA=';
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Remove the badge and restore the original favicon.
 */
export function removeFaviconBadge(): void {
  if (!badgeActive) return;
  badgeActive = false;

  try {
    if (originalFaviconEl && originalFaviconHref) {
      originalFaviconEl.href = originalFaviconHref;
    }
    originalFaviconHref = undefined;
    originalFaviconEl = null;
  } catch {
    // Ignore errors
  }
}

/** Check if the badge is currently active. */
export function isFaviconBadgeActive(): boolean {
  return badgeActive;
}
