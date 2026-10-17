import { PAGE_SIZES, PX_PER_MM } from './constants.js';

const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/* A fixed page: real size in mm, text area a whole number of lines tall. It never
   depends on the window, so page breaks never move; the page is scaled to fit. */
export function pageGeometry(s) {
  const preset = PAGE_SIZES[s.pageSize] || PAGE_SIZES.a5;
  const wMm = s.pageSize === 'custom' ? s.customWidth : preset.w;
  const hMm = s.pageSize === 'custom' ? s.customHeight : preset.h;
  const W = Math.round(clamp(wMm, 50, 420, 148) * PX_PER_MM);
  const H = Math.round(clamp(hMm, 50, 600, 210) * PX_PER_MM);
  const fs = clamp(s.fontSize, 8, 48, 15);
  const lh = Math.max(8, Math.round(fs * clamp(s.lineHeight, 1, 3, 1.6)));
  const m = Math.min(Math.round(clamp(s.margin, 2, 50, 14) * PX_PER_MM), Math.floor((W - 80) / 2));
  const colW = W - 2 * m;
  const top = Math.min(m, Math.floor((H - 2 * lh) / 2));
  const contentH = Math.max(lh * 2, Math.floor((H - 2 * top) / lh) * lh);
  return { W, H, fs, lh, m, colW, gap: 2 * m, top, contentH, bottom: H - top - contentH };
}

/* The theme view: the page is whatever the pane gives us. */
export function screenGeometry(vw, vh, s, fs, phone) {
  const narrow = vw < 600;
  const side = narrow ? 12 : 56; // room for the side page buttons
  const gap = narrow ? 24 : 64;
  const lh = Math.max(8, Math.round(fs * clamp(s.lineHeight, 1, 3, 1.6)));
  const avail = Math.max(120, vw - 2 * side);
  let n = s.pageMode === 'single' ? 1 : s.pageMode === 'double' ? 2 : (!phone && avail >= 2 * 380 + gap ? 2 : 1);
  let colW = Math.floor((avail - (n - 1) * gap) / n);
  if (n === 2 && colW < 220) { n = 1; colW = avail; }
  if (s.screenMaxWidth > 0) colW = Math.min(colW, Math.max(200, s.screenMaxWidth));
  const top = vh < 500 ? 12 : 24;
  const H = Math.max(lh * 3, Math.floor(vh));
  const contentH = Math.max(lh * 2, H - 2 * top);
  return { W: colW + gap, H, fs, lh, m: gap / 2, colW, gap, top, contentH, bottom: H - top - contentH, n, narrow };
}
