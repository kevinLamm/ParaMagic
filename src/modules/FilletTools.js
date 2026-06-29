export function createFilletTools({ toolbar, canvas }) {
  const button = toolbar.querySelector('[data-fillet-tool]');
  const constructionButton = toolbar.querySelector('[data-toggle-button]');
  let active = false;
  let selection = [];

  function clearSelection() {
    selection = [];
    canvas.setFeatureSelection([]);
  }

  function deactivate() {
    if (!active && selection.length === 0) return;
    active = false;
    clearSelection();
    button?.classList.remove('active');
    button?.setAttribute('aria-pressed', 'false');
    canvas.setFeatureCommandDelegate(null);
  }

  function activate() {
    active = true;
    clearSelection();
    button?.classList.add('active');
    button?.setAttribute('aria-pressed', 'true');
    window.dispatchEvent(new CustomEvent('paramagic:tool-activated', { detail: { source: 'fillet' } }));
    canvas.setFeatureCommandDelegate(delegate);
  }

  function toggle() {
    if (active) deactivate();
    else activate();
  }

  function isSupportedFeature(feature) {
    if (!feature) return false;
    if (feature.kind === 'segment' && feature.entityType === 'line') return true;
    if (feature.kind === 'arc' && feature.entityType === 'arc') return true;
    if (feature.kind === 'curve' && feature.entityType === 'curve') return true;
    return false;
  }

  function isConstructionMode() {
    return constructionButton?.getAttribute('aria-pressed') === 'true';
  }

  function selectFeature(feature) {
    if (!isSupportedFeature(feature)) return false;
    if (selection.some((selected) => selected.recordId === feature.recordId)) {
      selection = selection.filter((selected) => selected.recordId !== feature.recordId);
      canvas.setFeatureSelection(selection);
      return true;
    }
    selection = [...selection, feature].slice(-2);
    canvas.setFeatureSelection(selection);
    if (selection.length < 2) return true;
    const selectedLines = [...selection];
    deactivate();
    const created = canvas.addFillet(selectedLines[0], selectedLines[1], {
      construction: isConstructionMode() ? true : undefined,
    });
    if (!created) activate();
    return true;
  }

  const delegate = {
    pointerDown(event) {
      if (!active || event.button !== 0) return false;
      const handled = selectFeature(canvas.getFeatureFromEvent(event));
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
      return handled;
    },
    pointerMove() {
      return false;
    },
    keyDown(event) {
      if (!active || event.key !== 'Escape') return false;
      event.preventDefault();
      deactivate();
      return true;
    },
  };

  button?.addEventListener('click', toggle);
  window.addEventListener('paramagic:tool-activated', (event) => {
    if (event.detail?.source !== 'fillet' && active) deactivate();
  });

  return { activate, deactivate };
}
