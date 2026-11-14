// Suivi du ballon par sa couleur (app iPhone, jeux de dribble), à la manière d'un détecteur appris sur SON ballon :
// au calibrage, les couleurs du ballon (chroma Cb/Cr et luminosité grossière) sont apprises et comparées à celles du
// décor ; ensuite, à chaque image, on cherche la tache de ces couleurs, de la bonne taille, près de la dernière position.
// La couleur reste reconnaissable sur un ballon flou, là où un détecteur généraliste (YOLO) le perd ou le prend
// pour un frisbee. Calcul sur une grille réduite (environ 160 × 90) : quelques dixièmes de milliseconde par image.
import Foundation
import CoreVideo
import CoreGraphics

final class BallColor {
    // histogrammes 3D : Cb (16) × Cr (16) × luminosité (4)
    private static let bins = 16 * 16 * 4
    private var ball = [Float](repeating: 0, count: BallColor.bins)
    private var background = [Float](repeating: 0, count: BallColor.bins)
    private(set) var learned = false
    /// Rayon appris, en fraction de la largeur de l'image.
    private(set) var radius: CGFloat = 0.05

    private static func bin(_ y: UInt8, _ cb: UInt8, _ cr: UInt8) -> Int {
        (Int(cb) >> 4) * 64 + (Int(cr) >> 4) * 4 + (Int(y) >> 6)
    }

    /// Grille réduite de l'image : (Y, Cb, Cr) tous les `step` points du plan de chroma.
    private struct Grid { let w: Int; let h: Int; let px: [(UInt8, UInt8, UInt8)]; let imgW: Int; let imgH: Int }

    private func grid(_ p: CVPixelBuffer) -> Grid? {
        CVPixelBufferLockBaseAddress(p, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(p, .readOnly) }
        guard CVPixelBufferGetPlaneCount(p) >= 2,
              let yb = CVPixelBufferGetBaseAddressOfPlane(p, 0), let cb = CVPixelBufferGetBaseAddressOfPlane(p, 1) else { return nil }
        let yRow = CVPixelBufferGetBytesPerRowOfPlane(p, 0), cRow = CVPixelBufferGetBytesPerRowOfPlane(p, 1)
        let cw = CVPixelBufferGetWidthOfPlane(p, 1), ch = CVPixelBufferGetHeightOfPlane(p, 1)
        let step = max(1, cw / 160)
        let gw = cw / step, gh = ch / step
        let yp = yb.assumingMemoryBound(to: UInt8.self), cp = cb.assumingMemoryBound(to: UInt8.self)
        var px = [(UInt8, UInt8, UInt8)]()
        px.reserveCapacity(gw * gh)
        for gy in 0..<gh {
            let cy = gy * step
            for gx in 0..<gw {
                let cx = gx * step
                let y = yp[(cy * 2) * yRow + cx * 2]
                let o = cy * cRow + cx * 2
                px.append((y, cp[o], cp[o + 1]))
            }
        }
        return Grid(w: gw, h: gh, px: px, imgW: CVPixelBufferGetWidth(p), imgH: CVPixelBufferGetHeight(p))
    }

    /// Apprend le ballon dans un cercle (centre et rayon normalisés, repère image : origine en haut à gauche, rayon en
    /// fraction de la largeur). `blend` < 1 : mise à jour progressive d'un modèle déjà appris.
    func learn(_ p: CVPixelBuffer, cx: CGFloat, cy: CGFloat, r: CGFloat, blend: Float = 1) {
        guard let g = grid(p) else { return }
        var inside = [Float](repeating: 0, count: BallColor.bins), outside = inside
        let rx = r * CGFloat(g.w) * 0.7, ry = r * CGFloat(g.w) * 0.7 // cœur du ballon (les bords mélangent avec le décor)
        let ox = cx * CGFloat(g.w), oy = cy * CGFloat(g.h)
        var nIn: Float = 0, nOut: Float = 0
        for gy in 0..<g.h {
            for gx in 0..<g.w {
                let (y, cb, cr) = g.px[gy * g.w + gx]
                let dx = (CGFloat(gx) - ox) / max(1, rx), dy = (CGFloat(gy) - oy) / max(1, ry)
                let d = dx * dx + dy * dy
                let b = BallColor.bin(y, cb, cr)
                if d <= 1 { inside[b] += 1; nIn += 1 } else if d > 2.2 { outside[b] += 1; nOut += 1 }
            }
        }
        guard nIn >= 6, nOut > 0 else { return }
        for i in 0..<BallColor.bins {
            let a = inside[i] / nIn, o = outside[i] / nOut
            ball[i] = learned ? ball[i] * (1 - blend) + a * blend : a
            background[i] = learned ? background[i] * (1 - blend) + o * blend : o
        }
        radius = learned ? radius * CGFloat(1 - blend) + r * CGFloat(blend) : r
        learned = true
    }

    /// Cherche le ballon : tache des couleurs apprises, de taille plausible, la plus proche de `near` s'il est donné.
    /// Renvoie centre et rayon normalisés (repère image, rayon en fraction de la largeur) et un score de 0 à 1.
    func find(_ p: CVPixelBuffer, near: CGPoint?) -> (x: CGFloat, y: CGFloat, r: CGFloat, score: Float)? {
        guard learned, let g = grid(p) else { return nil }
        // carte « couleur du ballon » : rapport ballon / décor
        var mask = [Bool](repeating: false, count: g.w * g.h)
        for i in 0..<(g.w * g.h) {
            let (y, cb, cr) = g.px[i]
            let b = BallColor.bin(y, cb, cr)
            mask[i] = ball[b] > 0.004 && ball[b] > 3 * (background[b] + 0.0005)
        }
        // taches connexes
        var seen = [Bool](repeating: false, count: g.w * g.h)
        let expect = radius * CGFloat(g.w)
        let minArea = max(4, Int(.pi * expect * expect * 0.15)), maxArea = Int(.pi * expect * expect * 4) + 20
        var best: (x: CGFloat, y: CGFloat, r: CGFloat, score: Float, cost: CGFloat)? = nil
        var stack = [Int]()
        for start in 0..<(g.w * g.h) where mask[start] && !seen[start] {
            var area = 0, sx = 0, sy = 0, minX = g.w, maxX = 0, minY = g.h, maxY = 0
            stack.append(start); seen[start] = true
            while let i = stack.popLast() {
                let x = i % g.w, y = i / g.w
                area += 1; sx += x; sy += y
                minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
                for n in [i - 1, i + 1, i - g.w, i + g.w] where n >= 0 && n < mask.count && mask[n] && !seen[n] {
                    if (n == i - 1 && x == 0) || (n == i + 1 && x == g.w - 1) { continue }
                    seen[n] = true; stack.append(n)
                }
            }
            guard area >= minArea, area <= maxArea else { continue }
            let bw = CGFloat(maxX - minX + 1), bh = CGFloat(maxY - minY + 1)
            let fill = CGFloat(area) / (bw * bh) // une balle remplit ~78 % de sa boîte
            guard fill > 0.35, max(bw, bh) / max(1, min(bw, bh)) < 3 else { continue }
            let cx = (CGFloat(sx) / CGFloat(area) + 0.5) / CGFloat(g.w), cy = (CGFloat(sy) / CGFloat(area) + 0.5) / CGFloat(g.h)
            let r = max(bw, bh) / 2 / CGFloat(g.w)
            let sizeCost = abs(log(max(r, 0.001) / max(radius, 0.001)))
            let distCost = near.map { hypot(cx - $0.x, (cy - $0.y) * CGFloat(g.h) / CGFloat(g.w)) * 4 } ?? 0
            let cost = sizeCost + distCost
            if best == nil || cost < best!.cost {
                best = (cx, cy, r, Float(min(1, fill)), cost)
            }
        }
        guard let b = best, b.cost < 2.5 else { return nil }
        return (b.x, b.y, b.r, b.score)
    }
}
