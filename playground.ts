// Copyright (c) 2020 Yaindrop
//
// Licensed under the MIT license: https://opensource.org/licenses/MIT
// Permission is granted to use, copy, modify, and redistribute the work.
// Full license information available in the project LICENSE file.
//
// 多条曲线实时求交点 Real-time Intersection Solving of Multiple Curves
// 

/*
 * 类型定义 Type Definition
 */
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
    numEndInSections: number,
    level: number
}

type range = NumTuple<2>

/*
 * 参数 Parameters
 */

/* 算法参数 Algorithm Parameters */
// 单个象限内可容许暴力求解交点时的最大线段数量 How many segments are acceptable for naively solving intersection in a quadrant
const NUM_SECTIONS_TO_SOLVE_NAIVELY = 2

// 交点去重时精确到小数点后多少位 How many decimals to keep when filtering out duplicate intersections
const DECIMALS_TO_KEEP_FOR_POINT_ID = 4

/* 演示参数 Demonstration Parameters */
// 是否展示计算过程 Whether to show how quadrants are calculated
const DRAW_QUADRANTS = false 

// 是否计算曲线自交 Whether to calculate self-intersection
const SELF_INTERSECT = true // 为避免性能问题，开启时自动关闭展示计算过程 To avoid performance issue, set DRAW_QUADRANTS to false when true

// 曲线中两个锚点间的线段数量 How many segments to generate between every two anchors in curve
const SEGMENTS_BETWEEN_ANCHORS = 120

// 每帧每个锚点的运动距离 How much each anchor moves every frame
const MOVEMENT_SPEED = 0.1

// 每秒渲染帧数目标 Targeted frames per second
const TARGETED_FPS = 60

// 曲线颜色饱和度随机生成范围 Random range to generate color saturation value
const COLOR_SATURATION_RANGE: range = [0.6, 1]

// 曲线颜色亮度随机生成范围 Random range to generate color lightness value
const COLOR_LIGHTNESS_RANGE: range = [0.4, 0.8]

// 曲线数量随机生成范围 How many curves to generate 
const NUM_CURVES_RANGE: range = [1, 3]

// 曲线中锚点数量随机生成范围 How many anchors to generate per curve
const NUM_ANCHORS_RANGE: range = [4, 10]

// 锚点位置随机生成范围 How many anchors to generate per curve
const ANCHOR_POSITION_RANGE: range = [-20, 20]

// 锚点运动最大偏移量随机生成范围 How much each anchor can move away from its original position
const MOVEMENT_DELTA_RANGE: range = [10, 50]

/*
 * 绘图辅助 Drawing Helpers
 */
var scene: BABYLON.Scene
var resourcesToDispose: {dispose: () => void}[] = []
var advancedTexture: BABYLON.GUI.AdvancedDynamicTexture
const textLines: BABYLON.GUI.TextBlock[] = []

const drawRect: (r: rect, c: BABYLON.Color3, float?: number, alpha?: number, ) => void = ([[rminx, rminy], [rmaxx, rmaxy]], c, f = 0, a = 1) => {
    const rect = BABYLON.Mesh.CreateLines("rect", [
        new BABYLON.Vector3(rminx, rminy, -f), 
        new BABYLON.Vector3(rminx, rmaxy, -f), 
        new BABYLON.Vector3(rmaxx, rmaxy, -f),
        new BABYLON.Vector3(rmaxx, rminy, -f),
        new BABYLON.Vector3(rminx, rminy, -f), 
    ], scene)
    rect.color = c
    rect.alpha = a
    resourcesToDispose.push(rect)
}

const drawPoint: (p: point, c?: BABYLON.Color3) => void = ([x, y], c = new BABYLON.Color3(1, 1, 1)) => {
    const material = new BABYLON.StandardMaterial("pointMat", scene);
    material.alpha = 1;
    material.diffuseColor = c
    const point = BABYLON.Mesh.CreateSphere("point", 5, 1.2, scene)
    point.setAbsolutePosition(new BABYLON.Vector3(x, y, 0))
    point.material = material
    resourcesToDispose.push(point)
    resourcesToDispose.push(material)
}

const drawText: (s: string, line: number) => void = (s, line) => {
    while (textLines.length <= line) {
        const text = new BABYLON.GUI.TextBlock()
        text.color = "white"
        text.fontSize = 16
        text.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP
        text.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
        text.top = textLines.length * 20
        advancedTexture.addControl(text)
        textLines.push(text)
    }
    textLines[line].text = s
}

// input: h in [0,360] and s,v in [0,1] - output: r,g,b in [0,1]
const hslToRgb: (hsl: NumTuple<3>) => NumTuple<3> = ([h, s, l]) => {
  let a = s * Math.min(l, 1 - l);
  let f = (n, k = (n + h / 30) % 12) => l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);                 
  return [f(0), f(8), f(4)];
}   

/*
 * 算法 Algorithm
 */
const 
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
        }, divideRect(quad.bounding).map(r => ({ bounding: r, curveToSegments: new Map(), numEndInSections: 0, level: quad.level + 1 }))),
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
    let count = 0
    for (let quad = quads.shift()!; quad; quad = quads.shift()!) {
        count ++
        if (quad.numEndInSections <= NUM_SECTIONS_TO_SOLVE_NAIVELY) {
            const quadRes = quadrantIntersections(quad, selfIntersect)
            if (DRAW_QUADRANTS && !SELF_INTERSECT)
                drawRect(quad.bounding, quadRes.length > 0 ? new BABYLON.Color3(0, 1, 0): new BABYLON.Color3(1, 0, 0), 0.1 * quad.level)
            quadRes.forEach(r => res.push(r))
        } else {
            const quadDivide = divideQuadrant(quad).filter(q => q.curveToSegments.size >= (selfIntersect ? 1 : 2))
            if (DRAW_QUADRANTS && !SELF_INTERSECT) 
                drawRect(quad.bounding, quadDivide.length > 0 ? new BABYLON.Color3(1, 1, 0) : new BABYLON.Color3(0, 0, 0), 0.1 * quad.level, 0.3)
            quadDivide.forEach(q => quads.push(q))
        }
    }
    drawText("已检查象限 Quadrant inspected: " + count, 3)
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
    level: 0
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
curveSelfIntersections: (c: curve) => point[] = c => 
    distinctArray(divideTillSolved(initQuads([c]), true).map(([_1, _2, i]) => i), pointIdentifier),
twoCurvesIntersections: (c1: curve, c2: curve, selfIntersect?: boolean) => point[] = (c1, c2, selfIntersect = false) => 
    distinctArray(divideTillSolved(initQuads([c1, c2]), selfIntersect).map(([_1, _2, i]) => i), pointIdentifier),
resultIdentifierFactory: (curveToId: Map<curve, string>) => ((result: [curve, curve, point]) => string) = curveToId => 
    ([c1, c2, i]) => Array(c1, c2).map(c => curveToId.get(c)!).sort().reduce((cumu, cid) => cumu + "," + cid, pointIdentifier(i)),
multipleCurvesIntersections: (curves: curve[], selfIntersect?: boolean) => [curve, curve, point][] = (curves, selfIntersect = false) => 
        distinctArray(divideTillSolved(initQuads(curves), selfIntersect), resultIdentifierFactory(new Map(curves.map((c, idx) => [c, `c${idx}`] ))))

/*
 * 演示 Demonstration
 */
class Playground {
    public static CreateScene(engine: BABYLON.Engine, canvas: HTMLCanvasElement): BABYLON.Scene {
        scene = new BABYLON.Scene(engine);
        advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI")

        const camera = new BABYLON.ArcRotateCamera("camera1", 0, 0, -150, new BABYLON.Vector3(0, 0, -0), scene);
        camera.setPosition(new BABYLON.Vector3(0, 0, -150));
        camera.attachControl(canvas, true);
        const light1 = new BABYLON.PointLight("Omni1", new BABYLON.Vector3(0, 0, -150), scene);
        const light2 = new BABYLON.PointLight("Omni2", new BABYLON.Vector3(0, 0, 150), scene);

        const randomInRange: (r: range) => number = ([a, b]) => a + Math.random() * (b - a)
        const randomIntInRange: (r: range) => number = ([a, b]) => Math.floor(randomInRange([a, b + 1]))
        const randomDistinctColors: (n: number) => BABYLON.Color3[] = n => 
            Array(n).fill(360 * Math.random())
                .map((delta, idx) => hslToRgb([delta + idx * 360 / n, randomInRange(COLOR_SATURATION_RANGE), randomInRange(COLOR_LIGHTNESS_RANGE)]))
                .map(c => new BABYLON.Color3(...c))
        const blendColors = (c1: BABYLON.Color3, c2: BABYLON.Color3) =>
            new BABYLON.Color3(...["r", "g", "b"].map(channel => (c1[channel] + c2[channel]) / 2))
        const pointToVector3: (p :point) => BABYLON.Vector3 = ([x, y]) => new BABYLON.Vector3(x, y, 0)
        const vector3ToPoint: (v :BABYLON.Vector3) => point = ({ x: x, y: y }) => [x, y]
        const makeCatmullRomSpline: (points: point[], nbPoints?: number) => BABYLON.Curve3 = (points, nb = SEGMENTS_BETWEEN_ANCHORS) => 
            BABYLON.Curve3.CreateCatmullRomSpline(points.map(pointToVector3), nb);

        // hard-coded defaults
        // const curveAnchors: point[][] = [
        //     [[0, 0], [10, 1], [20, -14], [25, -21], [35, 30], [15, 30], [30, -30], [60, 0]],
        //     [[5, 1], [25, 16], [45, -21], [30, 30], [10, -30], [30, -10], [30, -50]],
        //     [[34, -3], [-25, 10], [15, -1], [3, 30], [40, 10], [12, -10]]]
        // const curveColors = [
        //     new BABYLON.Color3(0, 1, 1), 
        //     new BABYLON.Color3(1, 0, 1), 
        //     new BABYLON.Color3(0.7, 0.8, 0.1)]
        const curveAnchors: point[][] = 
            Array(randomIntInRange(NUM_CURVES_RANGE)).fill(0)
                .map(_ => Array(randomIntInRange(NUM_ANCHORS_RANGE)).fill(0)
                    .map(_ => [0, 0].map(_ => randomInRange(ANCHOR_POSITION_RANGE)) as point))
        const curveColors = randomDistinctColors(curveAnchors.length)
        const curveOptions = curveAnchors.map(anchors => 
            ({ points: makeCatmullRomSpline(anchors).getPoints(), updatable: true, instance: undefined }))
        curveOptions.forEach((options, idx) => 
            options.instance = BABYLON.MeshBuilder.CreateLines(`c${idx}`, options, scene))
        curveColors.forEach((c, idx) => curveOptions[idx].instance.color = c)
        var averageCalculationTime = 0
        var calculatedTimes = 0
        const curveStates = curveAnchors.map(anchors => 
            anchors.map(_ => [[0, 0], [0, 0].map(_ => Math.random() > 0.5), randomInRange(MOVEMENT_DELTA_RANGE)] as [[number, number], [boolean, boolean], number]))
        const interval = setInterval(() => {
            resourcesToDispose.forEach(m => m.dispose())
            resourcesToDispose = []
            try {
                curveAnchors.forEach((anchors, idx1) => {
                    anchors.forEach((p, idx2) => {
                        const [delta, increasing, range] = curveStates[idx1][idx2]
                        Array(0, 1).forEach(i => {
                            delta[i] += (increasing[i] ? MOVEMENT_SPEED : -MOVEMENT_SPEED) * ((1 + Math.random()) / 2)
                            p[i] += (increasing[i] ? MOVEMENT_SPEED : -MOVEMENT_SPEED)* ((1 + Math.random()) / 2)
                            if (delta[i] > range) increasing[i] = false; else if (delta[i] < -range) increasing[i] = true;
                        })
                    })
                })
                curveAnchors.forEach((anchors, idx) => {
                    const options = curveOptions[idx]
                    options.points = makeCatmullRomSpline(anchors).getPoints()
                    options.instance = BABYLON.MeshBuilder.CreateLines(`c${idx}`, options, scene);
                });
                
                const curvePoints: curve[] = curveOptions.map(option => option.points.map(vector3ToPoint))
                var calculationTime = Date.now()
                const intersections = multipleCurvesIntersections(curvePoints, SELF_INTERSECT)
                calculationTime = Date.now() - calculationTime
                intersections.forEach(([c1, c2, i]) => 
                        drawPoint(i, c1 == c2 ? curveColors[curvePoints.indexOf(c1)] : 
                        blendColors(...[c1, c2].map(c => curveColors[curvePoints.indexOf(c)]) as [BABYLON.Color3, BABYLON.Color3])))
                
                calculatedTimes ++
                averageCalculationTime = (calculationTime + (averageCalculationTime * (calculatedTimes - 1))) / calculatedTimes
                drawText("曲线数量 Curve Count: " + curveAnchors.length, 0)
                drawText("线段总数 Section Count: " + curvePoints.reduce((cumu, c) => cumu + c.length - 1, 0), 1)
                drawText("已找到交点 Intersections found: " + intersections.length, 2)
                drawText("平均计算耗时 Average Time Spent (ms): " + averageCalculationTime.toFixed(2), 4)
            } catch (e) {
                clearInterval(interval);
            }
        }, 1000/TARGETED_FPS)
        return scene;
    }
}
