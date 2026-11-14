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
        let pose = VNDetectHumanBodyPoseRequest()
        var requests: [VNRequest] = [pose]
        // YOLO à chaque image tant que le ballon n'est pas suivi, une image sur deux ensuite (le suivi Vision fait le lien).
        // Deux images sur trois, il n'analyse que la zone du joueur (des épaules au sol) : le ballon y paraît bien plus
        // grand pour le modèle (416 × 416 pixels), qui le rate sinon quand il est petit et flou.
        let useRoi = roi != nil && frameIndex % 3 != 0
        let yoloRequest: VNCoreMLRequest? = (frameIndex % 2 == 0 || lastBall == nil) ? yolo.map { m in
            let r = VNCoreMLRequest(model: m)
            r.imageCropAndScaleOption = .scaleFill
            if useRoi, let z = roi { r.regionOfInterest = z }
            return r
        } : nil
        if let y = yoloRequest { requests.append(y) }
        try? handler.perform(requests)

        var ball: [String: Any]? = nil
        var detected = false
        var objs: [[String: Any]] = []
        if let y = yoloRequest {
            let zone = useRoi ? (roi ?? CGRect(x: 0, y: 0, width: 1, height: 1)) : CGRect(x: 0, y: 0, width: 1, height: 1)
            // boîtes rendues dans le repère de la zone analysée → repère de l'image entière
            let full = { (b: CGRect) -> CGRect in
                CGRect(x: zone.minX + b.minX * zone.width, y: zone.minY + b.minY * zone.height, width: b.width * zone.width, height: b.height * zone.height)
            }
            let all = (y.results as? [VNRecognizedObjectObservation] ?? [])
            objs = all.prefix(4).map { ["l": $0.labels.first?.identifier ?? "?", "c": Double($0.labels.first?.confidence ?? 0)] }
            // Un ballon de basket est souvent reconnu comme « orange » par ce type de modèle
            let balls = all.filter { o in
                guard let l = o.labels.first else { return false }
                return (l.identifier == "sports ball" && l.confidence > 0.12) || (l.identifier == "orange" && l.confidence > 0.2)
            }
            // le plus proche de la position précédente, sinon le plus sûr
            let best = balls.min { a, b in
                guard let p = lastBall else { return a.confidence > b.confidence }
                let ra = full(a.boundingBox), rb = full(b.boundingBox)
                return hypot(ra.midX - p.midX, ra.midY - p.midY) < hypot(rb.midX - p.midX, rb.midY - p.midY)
            }
            if let b = best {
                let r = full(b.boundingBox)
                detected = true
                lastBall = r
                let t = VNTrackObjectRequest(detectedObjectObservation: VNDetectedObjectObservation(boundingBox: r))
                t.trackingLevel = .accurate
                trackRequest = t
                lostFrames = 0
                ball = box(r, w: w, h: h, conf: b.confidence, predicted: false)
            }
        }
        if !detected, let t = trackRequest {
            try? sequence.perform([t], on: pixels, orientation: .up)
            if let o = t.results?.first as? VNDetectedObjectObservation, o.confidence > 0.15 {
                t.inputObservation = o
                lastBall = o.boundingBox
                lostFrames = 0
                ball = box(o.boundingBox, w: w, h: h, conf: o.confidence, predicted: false)
            } else {
                lostFrames += 1
                // quelques images ratées (flou) : on garde la dernière position, annoncée comme prédite
                if lostFrames <= 4, let p = lastBall { ball = box(p, w: w, h: h, conf: 0.1, predicted: true) }
                else { trackRequest = nil; lastBall = nil }
            }
        }

        var joints: [String: [Double]] = [:]
        if let obs = pose.results?.first, let pts = try? obs.recognizedPoints(.all) {
            for (name, key) in LiveVision.joints {
                if let p = pts[name], p.confidence > 0.1 {
                    joints[key] = [Double(p.location.x), 1 - Double(p.location.y), Double(p.confidence)]
                }
            }
        }
        // Zone du joueur pour l'image suivante (repère Vision : origine en bas à gauche), des épaules jusqu'au sol
        if let obs = pose.results?.first, let pts = try? obs.recognizedPoints(.all) {
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
