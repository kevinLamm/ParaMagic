// Reading a saved drawing for diagnosis must not require loading it into the solver.
export function showDrawingDiagnostics({ name, content, error, download, document = globalThis.document }) {
  let saved;
  try { saved = JSON.parse(content); } catch { return false; }
  if (!saved || typeof saved !== 'object' || (!saved.entities && !saved.drawing && saved.format !== 'ParaMagic Drawing')) return false;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const dialog = document.createElement('section');
  dialog.className = 'modal drawing-diagnostics-modal';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Saved drawing diagnostics');
  const heading = document.createElement('h2');
  heading.textContent = 'Saved drawing needs repair';
  const explanation = document.createElement('p');
  explanation.textContent = `${name} is preserved and can be shared for diagnosis. It could not be opened for editing. The saved data is available below.`;
  const details = document.createElement('pre');
  details.className = 'drawing-diagnostics-errors';
  details.textContent = [String(error?.message || error),
    ...(Array.isArray(saved.saveDiagnostics?.errors) ? saved.saveDiagnostics.errors : []).map(issue => issue?.message),
  ].filter((message, index, all) => all.indexOf(message) === index).join('\n');
  const source = document.createElement('textarea');
  source.readOnly = true;
  source.setAttribute('aria-label', 'Saved drawing data');
  source.value = content;
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save a Copy';
  save.addEventListener('click', () => download(content, name, 'application/vnd.paramagic+json'));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  close.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('keydown', event => {
    if (event.key === 'Escape') backdrop.remove();
    if (event.key === 'Tab') {
      const controls = [close, source, save];
      const index = controls.indexOf(document.activeElement);
      event.preventDefault();
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
    }
  });
  dialog.append(close, heading, explanation, details, source, save);
  backdrop.append(dialog);
  document.body.append(backdrop);
  close.focus();
  return true;
}
