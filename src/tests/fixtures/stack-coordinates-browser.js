
    import { canvasController, initialization } from '../../main.js';
    import { transformStackEntity } from '../../../packages/paramagic-core/src/modules/StackCoordinates.js';
    await initialization;
    const response = await fetch('./stack-coordinates.paramagic');
    const drawing = await response.json();
    if (new URLSearchParams(location.search).has('rotated')) {
      const stack = drawing.extensions.stacks.stacks.find(({ name }) => name === 'Moving');
      const previous = stack.frame;
      stack.frame = { ...previous, rotation: Math.PI / 4 };
      for (const key of ['entities', 'dimensionAnnotations']) {
        drawing[key] = drawing[key].map(entity => entity.stackId === stack.id
          ? { ...transformStackEntity(transformStackEntity(entity, previous, true), stack.frame), coordinateFrame: stack.frame }
          : entity);
      }
      drawing.extensions.stacks.activeStackId = stack.id;
    }
    canvasController.loadDrawingData(drawing, { zoomToFit: true });
    document.title = 'Stack coordinate workflow';
    const roundTrip = document.createElement('button');
    roundTrip.textContent = 'Reload saved drawing';
    roundTrip.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:1000';
    roundTrip.addEventListener('click', () => {
      const saved = JSON.stringify(canvasController.getDrawingData());
      canvasController.loadDrawingData(JSON.parse(saved), { zoomToFit: false });
    });
    document.body.append(roundTrip);
    canvasController.onObjectsChange(() => {
      const drawing = canvasController.getDrawingData();
      console.debug('Stack fixture state', JSON.stringify({
        stackState: drawing.stackState,
        constraints: drawing.constraints,
        dimensions: drawing.dimensionAnnotations,
      }));
    });
