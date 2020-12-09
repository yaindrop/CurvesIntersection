interface TupleOf<T extends any, L extends number> extends Array<T> { 0: T, length: L }
type MatrixOf<T extends any, R extends number, C extends number> = TupleOf<TupleOf<T, C>, R>
type NumTuple<N extends number> = TupleOf<number, N>
type NumMatrix<R extends number, C extends number> = MatrixOf<number, R, C>

type point = NumTuple<2>
type rect = NumMatrix<2, 2>
type segment = NumMatrix<2, 2>
type curve = point[]
type Quadrant = {
    bounding: rect,
    curveToSegments: Map<curve, Set<segment>>,
    numEndInSections: number
}

const 
NUM_SECTIONS_TO_SOLVE_NAIVELY = 2,
DECIMALS_TO_KEEP_FOR_POINT_ID = 4,
threePointsCCW: (p1: point, p2: point, p3: point) => boolean = ([ax, ay], [bx, by], [cx, cy]) => 
    (cy - ay) * (bx - ax) > (by - ay) * (cx - ax),
twoSegmentsIntersect: (s1: segment, s2: segment) => boolean = ([a, b], [c, d]) => 
    threePointsCCW(a, c, d) != threePointsCCW(b, c, d) && threePointsCCW(a, b, c) != threePointsCCW(a, b, d),
pointInRect: (p: point, r: rect) => boolean = ([px, py], [[rminx, rminy], [rmaxx, rmaxy]]) => 
    px >= rminx && px <= rmaxx && py >= rminy && py <= rmaxy,
segmentEndInRect: (s: segment, r: rect) => boolean = ([s0, s1], r) => 
    pointInRect(s0, r) || pointInRect(s1, r),
flippedSegment: (s: segment) => segment = ([[p1x, p1y], [p2x, p2y]]) => 
    [[p1x, p2y], [p2x, p1y]],
segmentCrossRect: (s: segment, r: rect) => boolean = (s, r) => 
    twoSegmentsIntersect(s, r) || twoSegmentsIntersect(s, flippedSegment(r)),
divideRect: (r: rect) => rect[] = ([[rminx, rminy], [rmaxx, rmaxy]]) => {
    const rmidx = (rminx + rmaxx) / 2, rmidy = (rminy + rmaxy) / 2
    return [[[rminx, rminy], [rmidx, rmidy]], 
    [[rmidx, rminy], [rmaxx, rmidy]], 
    [[rminx, rmidy], [rmidx, rmaxy]], 
    [[rmidx, rmidy], [rmaxx, rmaxy]]]
},
divideQuadrant: (quad: Quadrant) => Quadrant[] = quad => 
    Array.from(quad.curveToSegments.entries())
        .reduce((newQuads, [c, segments]) => {
            segments.forEach(s => 
                newQuads.forEach(q => {
                    if (segmentEndInRect(s, q.bounding)) q.numEndInSections ++;
                    else if (!segmentCrossRect(s, q.bounding)) return
                    if (!q.curveToSegments.has(c)) q.curveToSegments.set(c, new Set());
                    q.curveToSegments.get(c)!.add(s)
                }))
            return newQuads
        }, divideRect(quad.bounding).map(r => ({ bounding: r, curveToSegments: new Map(), numEndInSections: 0 }))),
twoLinesIntersection: (s1: segment, s2: segment) => point | undefined = ([[ax, ay], [bx, by]], [[cx, cy], [dx, dy]]) => {
    const deltaX1 = ax - bx, deltaY1 = ay - by, deltaX2 = cx - dx, deltaY2 = cy - dy
    if (!deltaX1 && (!deltaY1 || !deltaX2) || !deltaY2 && (!deltaX2 || !deltaY1)) return undefined;
    else if (!deltaX1) return [(ay - dy)*deltaX2/deltaY2 + dx, ay];
    else if (!deltaY1) return [ax, (ax - dx)*deltaY2/deltaX2 + dy];
    else if (!deltaX2) return [(cy - by)*deltaX1/deltaY1 + bx, cy];
    else if (!deltaY2) return [cx, (cx - bx)*deltaY1/deltaX1 + by];
    const yx1 = deltaY1/deltaX1, yx2 = deltaY2/deltaX2, xy1 = 1/yx1, xy2 = 1/yx2
    return [(yx1*bx-yx2*dx-by+dy)/(yx1-yx2), (xy1*by-xy2*dy-bx+dx)/(xy1-xy2)]
},
twoSegmentsConnected: (s1: segment, s2: segment) => boolean = ([a, b], [c, d]) => 
    a == c || a == d || b == c || b == d,
quadrantIntersections: (q: Quadrant, selfIntersect: boolean) => [curve, curve, point][] = (q, selfIntersect) => {
    const res: [curve, curve, point][] = [], checkedCurve = new Set<curve>(), entries = Array.from(q.curveToSegments.entries())
    entries.forEach(([c1, segments]) => {
        checkedCurve.add(c1)
        segments.forEach(s1 => 
            entries.filter(([c2, _]) => selfIntersect || !checkedCurve.has(c2)).forEach(([c2, otherSegments]) => 
            otherSegments.forEach(s2 => {
                if ((!selfIntersect || !twoSegmentsConnected(s1, s2)) && twoSegmentsIntersect(s1, s2)) {
                    const intersection = twoLinesIntersection(s1, s2)
                    if (intersection) res.push([c1, c2, intersection]);
                }
            })))
    })
    return res
},
newNumMatrixFrom = <R extends number, C extends number>(m: NumMatrix<R, C>, f: (row: number, col: number, val: number) => number) => 
    m.map((row, r) => row.map((val, c) => f(r, c, val))) as NumMatrix<R, C>,
divideTillSolved: (quads: Quadrant[], selfIntersect?: boolean) => [curve, curve, point][] = (quads, selfIntersect = false) => {
    const res: [curve, curve, point][] = []
    for (let quad = quads.shift()!; quad; quad = quads.shift()!) {
        if (quad.numEndInSections <= NUM_SECTIONS_TO_SOLVE_NAIVELY) quadrantIntersections(quad, selfIntersect).forEach(r => res.push(r));
        else divideQuadrant(quad).filter(q => q.curveToSegments.size >= (selfIntersect ? 1 : 2)).forEach(q => quads.push(q));
    }
    return res
},
twoRectsFitInRect: (r1: rect, r2: rect) => rect = (r1, r2) => 
    newNumMatrixFrom(r1, (row, col, val) => (row ? Math.max : Math.min)(val, r2[row][col])),
multipleRectsFitInRect: (rects: rect[]) => rect = rects => 
    rects.reduce((cumu, r) => twoRectsFitInRect(cumu, r), [[0, 0], [0, 0]]),
curveFitInRect: (c: curve) => rect = c => 
    c.reduce<rect>((prev, curr) => 
        newNumMatrixFrom(prev, (row, col, val) => (row ? Math.max : Math.min)(val, curr[col])),
        [[Number.MAX_VALUE, Number.MAX_VALUE], [Number.MIN_VALUE, Number.MIN_VALUE]]),
curveSegments: (c: curve) => Set<segment> = c => 
    new Set(c.filter((_, idx) => c[idx + 1]).map((p, idx) => [p, c[idx + 1]])),
initQuads: (curves: curve[]) => Quadrant[] = curves => [{
    bounding: multipleRectsFitInRect(curves.map(curveFitInRect)), 
    curveToSegments: new Map(curves.map(c => [c, curveSegments(c)])),
    numEndInSections: curves.reduce((cumu, c) => cumu + c.length - 1, 0),
}],
distinctArray: <T>(arr: T[], distinctId: (val: T) => string) => T[] = (arr, distinctId) => {
    const countedVal = new Set<string>()
    return arr.filter(v => {
        const id = distinctId(v)
        if (countedVal.has(id)) return false;
        countedVal.add(id)
        return true
    })
},
pointIdentifier: (p: point) => string = ([x, y]) => 
    x.toFixed(DECIMALS_TO_KEEP_FOR_POINT_ID) + "," + y.toFixed(DECIMALS_TO_KEEP_FOR_POINT_ID),
curveIntersections: (c: curve) => point[] = c => 
    distinctArray(divideTillSolved(initQuads([c]), true).map(([_1, _2, i]) => i), pointIdentifier),
twoCurvesIntersections: (c1: curve, c2: curve, selfIntersect?: boolean) => point[] = (c1, c2, selfIntersect = false) => 
    distinctArray(divideTillSolved(initQuads([c1, c2]), selfIntersect).map(([_1, _2, i]) => i), pointIdentifier),
resultIdentifierFactory: (curveToId: Map<curve, string>) => ((result: [curve, curve, point]) => string) = curveToId => 
    ([c1, c2, i]) => Array(c1, c2).map(c => curveToId.get(c)!).sort().reduce((cumu, cid) => cumu + "," + cid, pointIdentifier(i)),
multipleCurvesIntersections: (curves: curve[], selfIntersect?: boolean) => [curve, curve, point][] = (curves, selfIntersect = false) => 
        distinctArray(divideTillSolved(initQuads(curves), selfIntersect), resultIdentifierFactory(new Map(curves.map((c, idx) => [c, `c${idx}`] ))))
