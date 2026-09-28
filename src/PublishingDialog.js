export { loadAccountPanel } from './PublishingAccountPanel.js';

export function createPublishingDialog(modal, title, markup) {
  const previousFocus = document.activeElement;
  modal(markup);
  const backdrop = [...document.querySelectorAll('.modal-backdrop')].at(-1);
  const dialog = backdrop.querySelector('.modal');
  const closeButton = dialog.querySelector('.close');
  const lifecycle = new AbortController();
  dialog.classList.add('drawing-publish-modal');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', title);
  let locked = false;
  function close() {
    if (locked) return;
    lifecycle.abort(); backdrop.remove(); previousFocus?.focus();
  }
  closeButton.onclick = close;
  backdrop.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button, input, textarea, a[href]')]
        .filter(element => !element.disabled && !element.closest('[hidden]'));
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  return { dialog, signal: lifecycle.signal, close, lock(value) { locked = value; closeButton.disabled = value; } };
}
