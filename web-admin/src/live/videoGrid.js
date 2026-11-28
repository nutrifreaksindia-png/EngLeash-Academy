/**
 * Decides how participant video tiles are arranged in a given area.
 * The mobile app has the same rule in mobile-app/src/live/videoGrid.ts: change both together.
 */
/** width / height */
const NARROWEST = 3 / 4;
const PORTRAIT_WIDEST = 4 / 5;
/** Only used where strict portrait tiles would be tiny, e.g. many people on a landscape phone. */
const RELAXED_WIDEST = 4 / 3;
function bestForShape(count, width, height, gap, widest) {
    let best = { columns: 1, rows: count, tileWidth: 0, tileHeight: 0 };
    let bestArea = -1;
    let bestEmpty = 0;
    for (let columns = 1; columns <= count; columns += 1) {
        const rows = Math.ceil(count / columns);
        let w = (width - gap * (columns - 1)) / columns;
        let h = (height - gap * (rows - 1)) / rows;
        if (w <= 0 || h <= 0)
            continue;
        if (w / h > widest)
            w = h * widest;
        else if (w / h < NARROWEST)
            h = w / NARROWEST;
        const tileWidth = Math.floor(w);
        const tileHeight = Math.floor(h);
        const area = tileWidth * tileHeight;
        const empty = columns * rows - count;
        // Near-equal sizes: prefer the arrangement with fewer gaps in the last row.
        if (area > bestArea * 1.02 || (area >= bestArea * 0.98 && empty < bestEmpty)) {
            best = { columns, rows, tileWidth, tileHeight };
            bestArea = area;
            bestEmpty = empty;
        }
    }
    return best;
}
export function gridFor(count, width, height, gap = 6) {
    const n = Math.max(1, count);
    const portrait = bestForShape(n, width, height, gap, PORTRAIT_WIDEST);
    const relaxed = bestForShape(n, width, height, gap, RELAXED_WIDEST);
    const portraitIsSmall = portrait.tileWidth < 150;
    const relaxedIsMuchBigger = relaxed.tileWidth * relaxed.tileHeight > portrait.tileWidth * portrait.tileHeight * 1.35;
    return portraitIsSmall && relaxedIsMuchBigger ? relaxed : portrait;
}
/** Splits into pages only when tiles would become too small to see. All pages use the same tile size. */
export function pagedGrid(count, width, height, options = {}) {
    const { gap = 6, minTileWidth = 84, minTileHeight = 104 } = options;
    const maxPerPage = options.maxPerPage ?? (Math.min(width, height) >= 500 ? 16 : 12);
    const total = Math.max(1, count);
    let perPage = Math.min(total, maxPerPage);
    let grid = gridFor(perPage, width, height, gap);
    while (perPage > 1 && (grid.tileWidth < minTileWidth || grid.tileHeight < minTileHeight)) {
        perPage -= 1;
        grid = gridFor(perPage, width, height, gap);
    }
    return { ...grid, perPage, pages: Math.ceil(total / perPage) };
}
