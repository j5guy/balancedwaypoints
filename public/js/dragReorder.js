// Native HTML5 drag-and-drop reordering for a list of direct children.
// No library (strict CSP, no CDN) — just dragstart/dragover/drop.
(function (root) {
    // Finds the direct child of `container` that either IS `target` or
    // contains it — deliberately not `target.closest('[data-drag-id]')`,
    // which would match the nearest ancestor at ANY depth and break when one
    // sortable container is nested inside another (e.g. draggable category
    // rows inside a draggable group list) by matching the wrong level.
    function itemForEvent(container, target) {
        for (const child of container.children) {
            if (child === target || child.contains(target)) return child;
        }
        return null;
    }

    // Makes the direct children of `container` reorderable — each one needs
    // `draggable="true"` and a `data-drag-id` attribute. `onReorder(ids)`
    // fires once per drop with the new top-to-bottom order of those ids.
    // Every handler calls stopPropagation() so nested sortable regions never
    // see each other's events — without it, a bubbled event from an inner
    // list would also reach an outer list's listeners and reorder the wrong
    // level entirely.
    function makeSortable(container, onReorder) {
        let draggedEl = null;

        container.addEventListener('dragstart', (e) => {
            const item = itemForEvent(container, e.target);
            if (!item) return;
            e.stopPropagation();
            draggedEl = item;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.dataset.dragId || '');
            setTimeout(() => item.classList.add('dragging'), 0);
        });

        container.addEventListener('dragend', (e) => {
            const item = itemForEvent(container, e.target);
            if (!item) return;
            e.stopPropagation();
            item.classList.remove('dragging');
            draggedEl = null;
        });

        container.addEventListener('dragover', (e) => {
            if (!draggedEl) return;
            // Always accept the drop while a drag is active — even when the
            // cursor is over the dragged row itself (its new position after
            // an earlier insertBefore) or over no row at all. Skipping
            // preventDefault() in those cases used to leave the browser
            // thinking the drop target was invalid, silently cancelling the
            // whole drag with no 'drop' event ever firing — easy to hit on
            // a short list, where the cursor often lands back on the row
            // you just moved right before you release the mouse.
            e.preventDefault();
            e.stopPropagation();
            const item = itemForEvent(container, e.target);
            if (!item || item === draggedEl) return;
            const rect = item.getBoundingClientRect();
            const after = (e.clientY - rect.top) / rect.height > 0.5;
            container.insertBefore(draggedEl, after ? item.nextSibling : item);
        });

        container.addEventListener('drop', (e) => {
            if (!draggedEl) return;
            e.preventDefault();
            e.stopPropagation();
            const ids = [...container.children].map(el => el.dataset.dragId).filter(Boolean);
            onReorder(ids);
        });
    }

    root.BWDragReorder = { makeSortable };
})(window);
