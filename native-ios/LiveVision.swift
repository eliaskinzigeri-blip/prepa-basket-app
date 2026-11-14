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
        // YOLO une image sur deux : le suivi Vision fait le lien entre deux détections
        let yoloRequest: VNCoreMLRequest? = (frameIndex % 2 == 0 || lastBall == nil) ? yolo.map { m in
            let r = VNCoreMLRequest(model: m)
            r.imageCropAndScaleOption = .scaleFill
            return r
        } : nil
        if let y = yoloRequest { requests.append(y) }
        try? handler.perform(requests)

        var ball: [String: Any]? = nil
        var detected = false
        if let y = yoloRequest {
            let balls = (y.results as? [VNRecognizedObjectObservation] ?? [])
                .filter { $0.labels.first?.identifier == "sports ball" && $0.labels.first!.confidence > 0.25 }
            // le plus proche de la position précédente, sinon le plus sûr
            let best = balls.min { a, b in
                guard let p = lastBall else { return a.confidence > b.confidence }
                return hypot(a.boundingBox.midX - p.midX, a.boundingBox.midY - p.midY) < hypot(b.boundingBox.midX - p.midX, b.boundingBox.midY - p.midY)
            }
            if let b = best {
                detected = true
                lastBall = b.boundingBox
                let t = VNTrackObjectRequest(detectedObjectObservation: VNDetectedObjectObservation(boundingBox: b.boundingBox))
                t.trackingLevel = .fast
                trackRequest = t
                ball = box(b.boundingBox, w: w, h: h, conf: b.confidence, predicted: false)
            }
        }
        if !detected, let t = trackRequest {
            try? sequence.perform([t], on: pixels, orientation: .up)
            if let o = t.results?.first as? VNDetectedObjectObservation, o.confidence > 0.3 {
                t.inputObservation = o
                lastBall = o.boundingBox
                ball = box(o.boundingBox, w: w, h: h, conf: o.confidence, predicted: false)
            } else {
                trackRequest = nil
                lastBall = nil
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
        emit([
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
