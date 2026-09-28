const viewing = new URLSearchParams(location.search).get('view');
if (viewing) {
  const { openDrawingViewer } = await import('./DrawingViewer.js');
  await openDrawingViewer(viewing);
} else {
  await import('./main.js');
}
