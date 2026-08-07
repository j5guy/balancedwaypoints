// Shared hover crosshair + tooltip for time-series charts (Dashboard's Net
// Worth/Cash Flow/Forecast widgets, the register's own Forecast chart, and
// the Reports page's Income vs Expense chart) — a vertical hairline tracks
// the pointer and snaps to the nearest data column; one tooltip lists every
// series at that column (dataviz: "one tooltip, every series", not a
// separate hover per line/bar). No charting library (see dragReorder.js's
// own note on why this app avoids CDN/npm UI dependencies) — plain SVG
// elements plus one positioned HTML div.
//
// Doesn't apply to the bar/pie charts (Spending by Category, the category
// donut) — dataviz's own rule is "on bars and cells... no crosshair, each
// mark carries its own tooltip", which those already have via native
// <title> elements.
(function () {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    // `svg`/`wrap` must already be in the DOM (getBoundingClientRect needs
    // real layout). `wrap` is the positioned (position:relative) container
    // the tooltip div anchors to — normally the same element whose
    // innerHTML was just set to the chart's <svg> markup.
    // `columns`: [{ x, label, series: [{ name, value, formattedValue, colorClass }] }]
    //   x/value are in viewBox units; a series with value == null is
    //   skipped (e.g. a projected-only or past-only line at that column).
    // `bounds`: { xLeft, xRight, yTop, yBottom } — the plot area in viewBox
    // units the hit layer and crosshair should span (each chart's own
    // padding differs, so this isn't inferred from the columns alone).
    function attach(svg, wrap, columns, bounds) {
        if (!svg || !columns.length) return;
        const { xLeft, xRight, yTop, yBottom } = bounds;

        const crosshair = document.createElementNS(SVG_NS, 'line');
        crosshair.setAttribute('class', 'chart-crosshair');
        crosshair.setAttribute('y1', yTop);
        crosshair.setAttribute('y2', yBottom);
        crosshair.style.display = 'none';
        svg.appendChild(crosshair);

        const seriesCount = columns[0].series.length;
        const dots = [];
        for (let i = 0; i < seriesCount; i++) {
            const dot = document.createElementNS(SVG_NS, 'circle');
            dot.setAttribute('class', 'chart-hover-dot');
            dot.setAttribute('r', 4);
            dot.style.display = 'none';
            svg.appendChild(dot);
            dots.push(dot);
        }

        const tooltip = document.createElement('div');
        tooltip.className = 'chart-tooltip';
        tooltip.hidden = true;
        wrap.appendChild(tooltip);

        // The crosshair finds the X — readers aim at a date, never at a
        // 2px line, so the hit target is the whole plot area, not the
        // marks themselves.
        const hit = document.createElementNS(SVG_NS, 'rect');
        hit.setAttribute('class', 'chart-hit-layer');
        hit.setAttribute('x', xLeft);
        hit.setAttribute('y', yTop);
        hit.setAttribute('width', Math.max(0, xRight - xLeft));
        hit.setAttribute('height', Math.max(0, yBottom - yTop));
        svg.appendChild(hit);

        function nearestColumn(viewBoxX) {
            let nearest = columns[0];
            let bestDist = Infinity;
            for (const c of columns) {
                const dist = Math.abs(c.x - viewBoxX);
                if (dist < bestDist) { bestDist = dist; nearest = c; }
            }
            return nearest;
        }

        function show(clientX) {
            const rect = svg.getBoundingClientRect();
            if (rect.width === 0) return;
            const viewBox = svg.viewBox.baseVal;
            const viewBoxX = (clientX - rect.left) * (viewBox.width / rect.width);
            const column = nearestColumn(viewBoxX);

            crosshair.setAttribute('x1', column.x);
            crosshair.setAttribute('x2', column.x);
            crosshair.style.display = '';

            column.series.forEach((s, i) => {
                const dot = dots[i];
                if (!dot) return;
                if (s.value == null) { dot.style.display = 'none'; return; }
                dot.setAttribute('cx', column.x);
                dot.setAttribute('cy', s.y);
                dot.setAttribute('class', `chart-hover-dot ${s.colorClass || ''}`);
                dot.style.display = '';
            });

            // Labels (series names, the column header) are untrusted data —
            // built via textContent, never innerHTML string concatenation.
            tooltip.innerHTML = '';
            const header = document.createElement('div');
            header.className = 'chart-tooltip-header';
            header.textContent = column.label;
            tooltip.appendChild(header);
            column.series.forEach((s) => {
                if (s.value == null) return;
                const row = document.createElement('div');
                row.className = 'chart-tooltip-row';
                const key = document.createElement('span');
                key.className = `chart-tooltip-key ${s.colorClass || ''}`;
                const name = document.createElement('span');
                name.className = 'chart-tooltip-name';
                name.textContent = s.name;
                const value = document.createElement('span');
                value.className = 'chart-tooltip-value';
                value.textContent = s.formattedValue;
                row.append(key, name, value);
                tooltip.appendChild(row);
            });
            tooltip.hidden = false;

            // The tooltip is a plain HTML div, not SVG, so its position is
            // computed in CLIENT pixels relative to `wrap` — clamped so it
            // never runs off either edge of the chart.
            const wrapRect = wrap.getBoundingClientRect();
            const columnClientX = rect.left + (column.x / viewBox.width) * rect.width - wrapRect.left;
            const tooltipWidth = tooltip.offsetWidth;
            let left = columnClientX + 12;
            if (left + tooltipWidth > wrapRect.width) left = columnClientX - tooltipWidth - 12;
            tooltip.style.left = `${Math.max(4, left)}px`;
        }

        function hide() {
            crosshair.style.display = 'none';
            dots.forEach((d) => { d.style.display = 'none'; });
            tooltip.hidden = true;
        }

        svg.addEventListener('pointermove', (e) => show(e.clientX));
        svg.addEventListener('pointerleave', hide);
    }

    window.BWChartHover = { attach };
})();
