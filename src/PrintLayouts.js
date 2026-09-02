const page = (id, portraitLabel, widthMm, heightMm, widthIn, heightIn, landscapeLabel = portraitLabel) => Object.freeze({
  id,
  portraitLabel,
  landscapeLabel,
  widthMm,
  heightMm,
  widthIn,
  heightIn,
});

export const PRINT_PAGE_SIZES = Object.freeze([
  page('letter', 'Letter / ANSI A', 215.9, 279.4, 8.5, 11),
  page('legal', 'Legal', 215.9, 355.6, 8.5, 14),
  page('ansi-b', 'Tabloid / ANSI B', 279.4, 431.8, 11, 17, 'Ledger / ANSI B'),
  page('ansi-c', 'ANSI C', 431.8, 558.8, 17, 22),
  page('ansi-d', 'ANSI D', 558.8, 863.6, 22, 34),
  page('ansi-e', 'ANSI E', 863.6, 1117.6, 34, 44),
  page('arch-a', 'ARCH A', 228.6, 304.8, 9, 12),
  page('arch-b', 'ARCH B', 304.8, 457.2, 12, 18),
  page('arch-c', 'ARCH C', 457.2, 609.6, 18, 24),
  page('arch-d', 'ARCH D', 609.6, 914.4, 24, 36),
  page('arch-e1', 'ARCH E1', 762, 1066.8, 30, 42),
  page('arch-e', 'ARCH E', 914.4, 1219.2, 36, 48),
  page('iso-a0', 'ISO A0', 841, 1189, 33.11, 46.81),
  page('iso-a1', 'ISO A1', 594, 841, 23.39, 33.11),
  page('iso-a2', 'ISO A2', 420, 594, 16.54, 23.39),
  page('iso-a3', 'ISO A3', 297, 420, 11.69, 16.54),
  page('iso-a4', 'ISO A4', 210, 297, 8.27, 11.69),
  page('iso-a5', 'ISO A5', 148, 210, 5.83, 8.27),
  page('iso-a6', 'ISO A6', 105, 148, 4.13, 5.83),
]);

export function printLayout(pageSize = 'letter', orientation = 'portrait') {
  const source = PRINT_PAGE_SIZES.find(({ id }) => id === pageSize) || PRINT_PAGE_SIZES[0];
  const landscape = orientation === 'landscape';
  return {
    id: source.id,
    orientation: landscape ? 'landscape' : 'portrait',
    label: landscape ? source.landscapeLabel : source.portraitLabel,
    mmWidth: landscape ? source.heightMm : source.widthMm,
    mmHeight: landscape ? source.widthMm : source.heightMm,
    inWidth: landscape ? source.heightIn : source.widthIn,
    inHeight: landscape ? source.widthIn : source.heightIn,
  };
}
