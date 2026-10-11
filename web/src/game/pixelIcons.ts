// Little pixel-art icons for buttons (instead of emoji, which every platform draws differently): inline
// SVGs on a 12 x 12 grid with crisp edges, filled with currentColor so they follow the button's colour and
// hover. Shown at 12 px (or a whole multiple) so the pixels stay square at 1x and 2x.

const ICONS: Record<string, string[]> = {
  trophy: [
    "............",
    ".##########.",
    "#.########.#",
    "#.########.#",
    ".#.######.#.",
    "...######...",
    "....####....",
    ".....##.....",
    ".....##.....",
    "....####....",
    "...######...",
    "............",
  ],
  camera: [
    "............",
    "...####.....",
    ".##########.",
    "############",
    "#####..#####",
    "####.##.####",
    "####.##.####",
    "#####..#####",
    "############",
    ".##########.",
    "............",
    "............",
  ],
  play: [
    "............",
    "..##........",
    "..####......",
    "..######....",
    "..########..",
    "..#########.",
    "..#########.",
    "..########..",
    "..######....",
    "..####......",
    "..##........",
    "............",
  ],
  pause: [
    "............",
    "............",
    "..###..###..",
    "..###..###..",
    "..###..###..",
    "..###..###..",
    "..###..###..",
    "..###..###..",
    "..###..###..",
    "..###..###..",
    "............",
    "............",
  ],
  close: [
    "............",
    ".##......##.",
    ".###....###.",
    "..###..###..",
    "...######...",
    "....####....",
    "....####....",
    "...######...",
    "..###..###..",
    ".###....###.",
    ".##......##.",
    "............",
  ],
};

export type IconName = keyof typeof ICONS;

/** an icon as an inline SVG string (runs of pixels become one path); label = it sits before text */
export function icon(name: IconName, size = 12, label = true): string {
  ensureCss();
  let d = "";
  ICONS[name].forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== "#") { x++; continue; }
      const x0 = x;
      while (row[x] === "#") x++;
      d += `M${x0} ${y}h${x - x0}v1h${x0 - x}z`;
    }
  });
  return `<svg class="px-icon${label ? " px-icon-label" : ""}" width="${size}" height="${size}" viewBox="0 0 12 12" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}

const CSS = `
.px-icon { display: inline-block; vertical-align: -1px; flex: none; }
.px-icon-label { margin-right: 7px; }
`;

let injected = false;
function ensureCss() {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const s = document.createElement("style");
  s.id = "px-icon-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}
