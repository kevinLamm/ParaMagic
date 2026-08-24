const htmlAttributeCharacters = /[&<>"']/g;
const htmlAttributeEscapes = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

export function toolIconAssetStyle(url) {
  const style = `--tool-icon-asset:url(${JSON.stringify(String(url))})`;
  return style.replace(htmlAttributeCharacters, (character) => htmlAttributeEscapes[character]);
}
