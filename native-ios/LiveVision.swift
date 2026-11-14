// Suivi en direct pour les jeux de dribble (app iPhone native) : caméra avant affichée DERRIÈRE l'app (la page web,
// transparente, garde le jeu et les cibles par-dessus), et à chaque image :
// - le ballon, détecté par YOLOv3 (Core ML, puce d'IA de l'iPhone, classe « sports ball ») une image sur deux,
//   et suivi entre deux détections par Vision (VNTrackObjectRequest) ;
// - le corps (poignets, hanches, chevilles…), détecté par Vision (VNDetectHumanBodyPoseRequest).
// Les positions sont envoyées à la page dans le repère de l'image de la caméra (0 à 1, origine en haut à gauche,
// non miroir) : la page les place à l'écran comme pour sa propre caméra (remplissage, effet miroir).
import Foundation
import AVFoundation
import Vision
import CoreML
import UIKit
import WebKit
import Capacitor

final class LiveVision: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let session = AVCaptureSession()
    private let output = AVCaptureVideoDataOutput()
    private let queue = DispatchQueue(label: "pb.livevision")
    private var preview: AVCaptureVideoPreviewLayer?
    private var previewView: UIView?
    private weak var webView: UIView?
    private let emit: ([String: Any]) -> Void
    private var yolo: VNCoreMLModel?
    private let sequence = VNSequenceRequestHandler()
    private var trackRequest: VNTrackObjectRequest?
    private var lastBall: CGRect?
    private var frameIndex = 0
    private var roi: CGRect?
    private let color = BallColor()
    /// Toucher du ballon à l'écran (repère image, origine en haut à gauche) à apprendre sur l'image suivante.
    var teachAt: CGPoint?
    var teachResult: ((Bool) -> Void)?
    private var lastJoints: [String: [Double]] = [:]
    private var lostFrames = 0
    private var orientationObserver: NSObjectProtocol?
    private(set) var running = false

    init(emit: @escaping ([String: Any]) -> Void) {
        self.emit = emit
        super.init()
    }

    // MARK: démarrage / arrêt

    func start(in vc: UIViewController, webView: UIView, completion: @escaping (String?) -> Void) {
        AVCaptureDevice.requestAccess(for: .video) { ok in
            guard ok else { completion("Autorise la caméra pour Prépa Basket dans Réglages."); return }
            self.queue.async {
                do {
                    try self.configure()
                    if self.yolo == nil, let url = Bundle.main.url(forResource: "YOLOv3Int8LUT", withExtension: "mlmodelc") {
                        let config = MLModelConfiguration()
                        config.computeUnits = .all
                        self.yolo = try? VNCoreMLModel(for: MLModel(contentsOf: url, configuration: config))
                    }
                    self.session.startRunning()
                    self.running = true
                    DispatchQueue.main.async {
                        self.attachPreview(vc: vc, webView: webView)
                        completion(nil)
                    }
                } catch {
                    completion("Caméra indisponible : \(error.localizedDescription)")
                }
            }
        }
    }

    /// Apprend la couleur du ballon touché à l'écran (repère image : origine en haut à gauche), sur l'image suivante.
    func teach(x: CGFloat, y: CGFloat, done: @escaping (Bool) -> Void) {
        queue.async { self.teachAt = CGPoint(x: x, y: y); self.teachResult = done }
    }

    func stop() {
        running = false
        queue.async { if self.session.isRunning { self.session.stopRunning() } }
        DispatchQueue.main.async {
            self.previewView?.removeFromSuperview()
            self.previewView = nil
            self.preview = nil
            if let wv = self.webView { wv.isOpaque = true; wv.backgroundColor = .black; (wv as? UIScrollView)?.backgroundColor = .black }
            if let o = self.orientationObserver { NotificationCenter.default.removeObserver(o) }
            self.orientationObserver = nil
            UIApplication.shared.isIdleTimerDisabled = false
        }
        trackRequest = nil
        lastBall = nil
    }

    private func configure() throws {
        guard session.inputs.isEmpty else { return }
        session.beginConfiguration()
        session.sessionPreset = .hd1280x720
        guard let cam = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else {
            throw NSError(domain: "LiveVision", code: 1, userInfo: [NSLocalizedDescriptionKey: "pas de caméra avant"])
        }
        let input = try AVCaptureDeviceInput(device: cam)
        if session.canAddInput(input) { session.addInput(input) }
        // 60 images/s si la caméra le permet : un dribble est rapide
        if let format = cam.formats.first(where: { f in
            let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            return d.width == 1280 && d.height == 720 && f.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= 60 }
        }) {
            try? cam.lockForConfiguration()
            cam.activeFormat = format
            cam.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 60)
            cam.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 60)
            cam.unlockForConfiguration()
        }
        // Temps de pose court (1/250 s au plus) : en intérieur, la caméra allonge sinon la pose et un ballon en dribble
        // devient une traînée floue que le modèle ne reconnaît plus. L'image est un peu plus granuleuse, mais nette.
        if (try? cam.lockForConfiguration()) != nil {
            if cam.isExposureModeSupported(.continuousAutoExposure) { cam.exposureMode = .continuousAutoExposure }
            let fast = CMTime(value: 1, timescale: 250)
            cam.activeMaxExposureDuration = CMTimeMaximum(fast, cam.activeFormat.minExposureDuration)
            cam.unlockForConfiguration()
        }
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        if session.canAddOutput(output) { session.addOutput(output) }
        session.commitConfiguration()
    }

    private func attachPreview(vc: UIViewController, webView: UIView) {
        self.webView = webView
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        let v = UIView(frame: webView.bounds)
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        v.backgroundColor = .black
        layer.frame = v.bounds
        v.layer.addSublayer(layer)
        // la caméra derrière la page, la page transparente par-dessus (cibles, score, boutons)
        webView.superview?.insertSubview(v, belowSubview: webView)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        (webView as? UIScrollView)?.backgroundColor = .clear
        if let wk = webView as? WKWebViewLike { wk.clearScrollBackground() }
        previewView = v
        preview = layer
        UIApplication.shared.isIdleTimerDisabled = true
        applyOrientation()
        orientationObserver = NotificationCenter.default.addObserver(forName: UIDevice.orientationDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.applyOrientation()
            if let v = self?.previewView { self?.preview?.frame = v.bounds }
        }
    }

    /// Image de la caméra tournée comme l'écran (portrait ou paysage), pour l'aperçu et pour l'analyse.
    private func applyOrientation() {
        let io = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.interfaceOrientation ?? .portrait
        let vo: AVCaptureVideoOrientation = io == .landscapeLeft ? .landscapeLeft : io == .landscapeRight ? .landscapeRight : io == .portraitUpsideDown ? .portraitUpsideDown : .portrait
        preview?.connection?.videoOrientation = vo
        if let v = previewView { preview?.frame = v.bounds }
        queue.async {
            if let c = self.output.connection(with: .video) {
                c.videoOrientation = vo
                c.isVideoMirrored = false // positions envoyées non miroir : la page applique l'effet miroir
            }
        }
    }

    // MARK: analyse de chaque image

    func captureOutput(_ output: AVCaptureOutput, didOutput sample: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard running, let pixels = CMSampleBufferGetImageBuffer(sample) else { return }
        frameIndex += 1
        let w = CVPixelBufferGetWidth(pixels), h = CVPixelBufferGetHeight(pixels)
        let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .up)
        // Corps une image sur deux (il bouge moins vite que le ballon), ballon à chaque image
        let pose = VNDetectHumanBodyPoseRequest()
        let poseNow = frameIndex % 2 == 0
        var requests: [VNRequest] = poseNow ? [pose] : []
        // YOLO (416 × 416 pixels) : à chaque image tant que la couleur du ballon n'est pas apprise, ensuite une image sur
        // quatre pour confirmer et rafraîchir les couleurs. Zone analysée : autour du ballon, sinon la zone du joueur.
        let unit = CGRect(x: 0, y: 0, width: 1, height: 1)
        var zone = unit
        if let p = lastBall {
            let side = max(0.4, max(p.width, p.height) * 4)
            zone = CGRect(x: p.midX - side / 2, y: p.midY - side / 2, width: side, height: side).intersection(unit)
        } else if let z = roi, frameIndex % 3 != 0 { zone = z }
        let runYolo = !color.learned || frameIndex % 4 == 0
        let yoloRequest: VNCoreMLRequest? = runYolo ? yolo.map { m in
            let r = VNCoreMLRequest(model: m)
            r.imageCropAndScaleOption = .scaleFill
            if zone != unit { r.regionOfInterest = zone }
            return r
        } : nil
        if let y = yoloRequest { requests.append(y) }
        try? handler.perform(requests)

        var ball: [String: Any]? = nil
        var objs: [[String: Any]] = []
        var yoloBall: (r: CGRect, conf: Float)? = nil
        if let y = yoloRequest {
            let full = { (b: CGRect) -> CGRect in
                CGRect(x: zone.minX + b.minX * zone.width, y: zone.minY + b.minY * zone.height, width: b.width * zone.width, height: b.height * zone.height)
            }
            let all = (y.results as? [VNRecognizedObjectObservation] ?? [])
            objs = all.prefix(4).map { ["l": $0.labels.first?.identifier ?? "?", "c": Double($0.labels.first?.confidence ?? 0)] }
            // Un ballon peu coloré est souvent vu comme « frisbee » ou « orange » par ce modèle généraliste
            let names: Set<String> = ["sports ball", "frisbee", "orange"]
            let best = all.filter { o in names.contains(o.labels.first?.identifier ?? "") && (o.labels.first?.confidence ?? 0) > 0.3 }
                .max { $0.confidence < $1.confidence }
            if let b = best { yoloBall = (full(b.boundingBox), b.confidence) }
        }

        // Repère Vision (origine en bas à gauche) ↔ repère image (origine en haut à gauche)
        let toImg = { (r: CGRect) -> (CGFloat, CGFloat, CGFloat) in (r.midX, 1 - r.midY, max(r.width, r.height * CGFloat(h) / CGFloat(w)) / 2) }

        // Apprentissage des couleurs : toucher à l'écran (demandé par la page), sinon la première détection franche de YOLO
        if let tap = teachAt {
            teachAt = nil
            color.learn(pixels, cx: tap.x, cy: tap.y, r: 0.025)
            if let f = color.find(pixels, near: tap) { color.learn(pixels, cx: f.x, cy: f.y, r: f.r); teachResult?(true) }
            else { teachResult?(color.learned) }
            teachResult = nil
        } else if let yb = yoloBall, yb.conf > 0.45, !color.learned {
            let (cx, cy, r) = toImg(yb.r)
            color.learn(pixels, cx: cx, cy: cy, r: r)
        }

        // Ballon : par sa couleur (rapide, résiste au flou), YOLO quand la couleur n'est pas encore apprise ou perdue
        let near = lastBall.map { CGPoint(x: $0.midX, y: 1 - $0.midY) }
        if color.learned, let f = color.find(pixels, near: near) {
            lostFrames = 0
            lastBall = CGRect(x: f.x - f.r, y: 1 - f.y - f.r * CGFloat(w) / CGFloat(h), width: f.r * 2, height: f.r * 2 * CGFloat(w) / CGFloat(h))
            ball = ["x": Double(f.x), "y": Double(f.y), "r": Double(f.r), "score": Double(f.score), "predicted": false, "src": "color"]
            // YOLO confirme au même endroit : couleurs rafraîchies (la lumière change)
            if let yb = yoloBall {
                let (cx, cy, r) = toImg(yb.r)
                if hypot(cx - f.x, cy - f.y) < 0.08 { color.learn(pixels, cx: cx, cy: cy, r: r, blend: 0.1) }
            }
        } else if let yb = yoloBall {
            lostFrames = 0
            lastBall = yb.r
            ball = box(yb.r, w: w, h: h, conf: yb.conf, predicted: false)
            ball?["src"] = "yolo"
        } else {
            lostFrames += 1
            // quelques images ratées : on garde la dernière position, annoncée comme prédite
            if lostFrames <= 4, let p = lastBall { ball = box(p, w: w, h: h, conf: 0.1, predicted: true) }
            else { lastBall = nil }
        }

        var joints: [String: [Double]] = poseNow ? [:] : lastJoints
        if poseNow, let obs = pose.results?.first, let pts = try? obs.recognizedPoints(.all) {
            for (name, key) in LiveVision.joints {
                if let p = pts[name], p.confidence > 0.1 {
                    joints[key] = [Double(p.location.x), 1 - Double(p.location.y), Double(p.confidence)]
                }
            }
        }
        if poseNow { lastJoints = joints }
        // Zone du joueur pour les images suivantes (repère Vision : origine en bas à gauche), des épaules jusqu'au sol
        if !poseNow {
            // corps pas analysé sur cette image : la zone précédente reste valable
        } else if let obs = pose.results?.first, let pts = try? obs.recognizedPoints(.all) {
            let ok = pts.values.filter { $0.confidence > 0.2 }
            if ok.count >= 4 {
                let xs = ok.map { $0.location.x }, ys = ok.map { $0.location.y }
                let minX = xs.min()!, maxX = xs.max()!, topY = ys.max()!
                let wide = max(0.35, (maxX - minX) * 2.2)
                let cx = (minX + maxX) / 2
                let x0 = max(0, cx - wide / 2), x1 = min(1, cx + wide / 2)
                let y1 = min(1, topY + 0.05)
                roi = CGRect(x: x0, y: 0, width: x1 - x0, height: y1)
            }
        } else { roi = nil }

        emit([
            "objs": objs,
            "t": CACurrentMediaTime() * 1000,
            "w": w, "h": h,
            "ball": ball ?? NSNull(),
            "pose": joints.isEmpty ? NSNull() : joints,
            "light": luma(pixels),
        ])
    }

    /// Articulations envoyées à la page (mêmes noms que l'index LM de la page).
    static let joints: [(VNHumanBodyPoseObservation.JointName, String)] = [
        (.nose, "nose"), (.leftShoulder, "lShoulder"), (.rightShoulder, "rShoulder"), (.leftElbow, "lElbow"), (.rightElbow, "rElbow"),
        (.leftWrist, "lWrist"), (.rightWrist, "rWrist"), (.leftHip, "lHip"), (.rightHip, "rHip"), (.leftKnee, "lKnee"), (.rightKnee, "rKnee"),
        (.leftAnkle, "lAnkle"), (.rightAnkle, "rAnkle"),
    ]

    /// Boîte Vision (origine en bas à gauche) → centre et rayon dans le repère de l'image (origine en haut à gauche).
    private func box(_ r: CGRect, w: Int, h: Int, conf: Float, predicted: Bool) -> [String: Any] {
        let rad = max(r.width * CGFloat(w), r.height * CGFloat(h)) / 2 / CGFloat(w)
        return ["x": Double(r.midX), "y": Double(1 - r.midY), "r": Double(rad), "score": Double(conf), "predicted": predicted]
    }

    /// Luminosité moyenne (0 à 255) sur une grille de points du plan Y.
    private func luma(_ p: CVPixelBuffer) -> Double {
        CVPixelBufferLockBaseAddress(p, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(p, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(p, 0) else { return 0 }
        let w = CVPixelBufferGetWidthOfPlane(p, 0), h = CVPixelBufferGetHeightOfPlane(p, 0), row = CVPixelBufferGetBytesPerRowOfPlane(p, 0)
        let ptr = base.assumingMemoryBound(to: UInt8.self)
        var sum = 0, n = 0
        for y in stride(from: 0, to: h, by: h / 24 + 1) { for x in stride(from: 0, to: w, by: w / 32 + 1) { sum += Int(ptr[y * row + x]); n += 1 } }
        return n > 0 ? Double(sum) / Double(n) : 0
    }
}

/// Fond de la vue de défilement de la page transparent aussi (sinon elle cache la caméra).
protocol WKWebViewLike { func clearScrollBackground() }
extension WKWebView: WKWebViewLike {
    func clearScrollBackground() { scrollView.backgroundColor = .clear; scrollView.isOpaque = false }
}
