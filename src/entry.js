const viewing = new URLSearchParams(location.search).get('view');
if (new URLSearchParams(location.search).has('view')) {
  document.title = 'ParaMagic viewer';
  const { openDrawingViewer } = await import('./DrawingViewer.js');
  await openDrawingViewer(viewing);
} else {
  await import('./main.js');
}
