// Module natif « PrepaVision » de l'app iPhone (Capacitor) :
// - jump3D : détente verticale mesurée avec le suivi du corps en 3D d'ARKit (caméra arrière, sans LiDAR). La hauteur
//   du saut = montée du bassin (articulation racine du squelette) au-dessus de sa position debout, en mètres réels
//   (le suivi du monde d'ARKit est à l'échelle grâce aux capteurs de mouvement). 3 essais guidés à la voix.
// - analyzeTrajectories : trajectoires de ballon détectées par Vision (VNDetectTrajectoriesRequest) dans la vidéo
//   d'une session de shoot, envoyée par morceaux (beginFile / appendFile). En essai, à côté de l'analyse actuelle.
import Foundation
import Capacitor
import ARKit
import Vision
import AVFoundation
import UIKit

@objc(PrepaVisionPlugin)
public class PrepaVisionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrepaVisionPlugin"
    public let jsName = "PrepaVision"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "jump3D", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "analyzeTrajectories", returnType: CAPPluginReturnPromise),
    ]

    private var fileURL: URL?
    private var fileHandle: FileHandle?

    @objc func capabilities(_ call: CAPPluginCall) {
        call.resolve(["bodyTracking": ARBodyTrackingConfiguration.isSupported, "trajectories": true])
    }

    // MARK: sauts en 3D

    @objc func jump3D(_ call: CAPPluginCall) {
        guard ARBodyTrackingConfiguration.isSupported else {
            call.reject("Le suivi du corps en 3D n'est pas disponible sur ce téléphone.")
            return
        }
        let trials = call.getInt("trials") ?? 3
        DispatchQueue.main.async {
            let vc = Jump3DViewController(trials: trials) { result in call.resolve(result) }
            vc.modalPresentationStyle = .fullScreen
            self.bridge?.viewController?.present(vc, animated: true)
        }
    }

    // MARK: vidéo envoyée par morceaux

    @objc func beginFile(_ call: CAPPluginCall) {
        let ext = call.getString("ext") ?? "mp4"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("pb-shoot-\(UUID().uuidString).\(ext)")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        try? fileHandle?.close()
        fileURL = url
        fileHandle = try? FileHandle(forWritingTo: url)
        call.resolve(["ok": fileHandle != nil])
    }

    @objc func appendFile(_ call: CAPPluginCall) {
        guard let h = fileHandle, let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.reject("Morceau de vidéo illisible.")
            return
        }
        h.write(data)
        call.resolve()
    }

    @objc func analyzeTrajectories(_ call: CAPPluginCall) {
        try? fileHandle?.close()
        fileHandle = nil
        guard let url = fileURL else { call.reject("Aucune vidéo reçue."); return }
        DispatchQueue.global(qos: .userInitiated).async {
            defer { try? FileManager.default.removeItem(at: url) }
            do {
                let result = try TrajectoryAnalyzer.analyze(url: url)
                call.resolve(result)
            } catch {
                call.reject("Analyse impossible : \(error.localizedDescription)")
            }
        }
    }
}

// MARK: - Trajectoires (Vision)

enum TrajectoryAnalyzer {
    struct Track { var t0: Double; var t1: Double; var points: [[Double]]; var confidence: Float; var coeffs: [Double] }

    static func analyze(url: URL) throws -> [String: Any] {
        let asset = AVURLAsset(url: url)
        guard let track = asset.tracks(withMediaType: .video).first else {
            throw NSError(domain: "PrepaVision", code: 1, userInfo: [NSLocalizedDescriptionKey: "pas de piste vidéo"])
        }
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange])
        output.alwaysCopiesSampleData = false
        reader.add(output)
        reader.startReading()

        let orientation = orientationOf(track.preferredTransform)
        let request = VNDetectTrajectoriesRequest(frameAnalysisSpacing: .zero, trajectoryLength: 8)
        // Taille d'un ballon dans l'image (rayon normalisé) : ni un pixel de bruit, ni une personne
        request.objectMinimumNormalizedRadius = 0.004
        request.objectMaximumNormalizedRadius = 0.06
        let handler = VNSequenceRequestHandler()
        var tracks: [UUID: Track] = [:]
        var frames = 0

        while reader.status == .reading, let sample = output.copyNextSampleBuffer() {
            guard let pixels = CMSampleBufferGetImageBuffer(sample) else { continue }
            frames += 1
            try? handler.perform([request], on: pixels, orientation: orientation)
            for obs in request.results ?? [] {
                let tr = obs.timeRange
                let t0 = CMTimeGetSeconds(tr.start), t1 = CMTimeGetSeconds(CMTimeRangeGetEnd(tr))
                let pts = obs.detectedPoints.map { [Double($0.x), 1 - Double($0.y)] } // origine en haut à gauche
                let c = obs.equationCoefficients
                if var cur = tracks[obs.uuid] {
                    cur.t1 = max(cur.t1, t1)
                    if let last = pts.last { cur.points.append(last) }
                    cur.confidence = max(cur.confidence, obs.confidence)
                    cur.coeffs = [Double(c.x), Double(c.y), Double(c.z)]
                    tracks[obs.uuid] = cur
                } else {
                    tracks[obs.uuid] = Track(t0: t0, t1: t1, points: pts, confidence: obs.confidence, coeffs: [Double(c.x), Double(c.y), Double(c.z)])
                }
            }
        }
        let list = tracks.values.sorted { $0.t0 < $1.t0 }.map { t -> [String: Any] in
            ["t0": t.t0, "t1": t.t1, "confidence": t.confidence, "coeffs": t.coeffs, "points": Array(t.points.suffix(120))]
        }
        return ["frames": frames, "duration": CMTimeGetSeconds(asset.duration), "trajectories": list]
    }

    static func orientationOf(_ t: CGAffineTransform) -> CGImagePropertyOrientation {
        switch (t.a, t.b, t.c, t.d) {
        case (0, 1, -1, 0): return .right
        case (0, -1, 1, 0): return .left
        case (-1, 0, 0, -1): return .down
        default: return .up
        }
    }
}

// MARK: - Sauts en 3D (ARKit)

final class Jump3DViewController: UIViewController, ARSessionDelegate {
    private enum Phase { case placing, steady, countdown, flight, done }

    private let trials: Int
    private let onDone: ([String: Any]) -> Void
    private let arView = ARSCNView(frame: .zero)
    private let label = UILabel()
    private let detail = UILabel()
    private let speech = AVSpeechSynthesizer()
    private var phase: Phase = .placing
    private var history: [(t: TimeInterval, y: Float)] = []
    private var baseline: Float = 0
    private var goAt: TimeInterval = 0
    private var peak: Float = -.infinity
    private var tracked = 0, seen = 0
    private var results: [Any] = []
    private var reasons: [Any] = []
    private var stature: Float = 0
    private var finished = false

    init(trials: Int, onDone: @escaping ([String: Any]) -> Void) {
        self.trials = max(1, min(5, trials))
        self.onDone = onDone
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) non utilisé") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        arView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(arView)
        for l in [label, detail] {
            l.translatesAutoresizingMaskIntoConstraints = false
            l.textColor = .white
            l.textAlignment = .center
            l.numberOfLines = 0
            l.layer.shadowColor = UIColor.black.cgColor
            l.layer.shadowOpacity = 0.8
            l.layer.shadowRadius = 6
            l.layer.shadowOffset = .zero
            view.addSubview(l)
        }
        label.font = .systemFont(ofSize: 44, weight: .heavy)
        detail.font = .systemFont(ofSize: 18, weight: .semibold)
        let close = UIButton(type: .system)
        close.translatesAutoresizingMaskIntoConstraints = false
        close.setTitle("Annuler", for: .normal)
        close.setTitleColor(.white, for: .normal)
        close.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        close.backgroundColor = UIColor(white: 0, alpha: 0.5)
        close.layer.cornerRadius = 14
        close.contentEdgeInsets = UIEdgeInsets(top: 10, left: 18, bottom: 10, right: 18)
        close.addTarget(self, action: #selector(cancel), for: .touchUpInside)
        view.addSubview(close)
        NSLayoutConstraint.activate([
            arView.topAnchor.constraint(equalTo: view.topAnchor), arView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            arView.leadingAnchor.constraint(equalTo: view.leadingAnchor), arView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor), label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 16),
            detail.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 12),
            detail.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20), detail.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            close.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
        ])
        arView.session.delegate = self
        show("Place-toi", "Pose le téléphone face à toi, écran vers le mur, à 3 m. Tout ton corps doit être dans l'image.")
        say("Place-toi à trois mètres, tout le corps dans l'image, et ne bouge plus.")
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        let config = ARBodyTrackingConfiguration()
        config.automaticSkeletonScaleEstimationEnabled = true
        arView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
        UIApplication.shared.isIdleTimerDisabled = true
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        arView.session.pause()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    @objc private func cancel() { finish(cancelled: true) }

    private func show(_ big: String, _ small: String = "") {
        DispatchQueue.main.async { self.label.text = big; self.detail.text = small }
    }
    private func say(_ text: String) {
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "fr-FR")
        u.rate = 0.52
        speech.stopSpeaking(at: .immediate)
        speech.speak(u)
    }

    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard let body = anchors.compactMap({ $0 as? ARBodyAnchor }).first else { return }
        let now = CACurrentMediaTime()
        let y = body.transform.columns.3.y
        if body.isTracked {
            history.append((now, y))
            history.removeAll { now - $0.t > 2.0 }
            // taille estimée (tête → pieds), pour vérifier l'échelle après coup
            let sk = body.skeleton
            if let head = sk.modelTransform(for: .head), let lf = sk.modelTransform(for: .leftFoot), let rf = sk.modelTransform(for: .rightFoot) {
                stature = head.columns.3.y - (lf.columns.3.y + rf.columns.3.y) / 2
            }
        }
        switch phase {
        case .placing, .steady:
            let recent = history.filter { now - $0.t < 1.0 }.map { $0.y }
            guard body.isTracked, recent.count >= 20, let lo = recent.min(), let hi = recent.max() else {
                if phase == .steady { phase = .placing; show("Place-toi", "Je ne te vois plus en entier.") }
                return
            }
            if hi - lo < 0.015 {
                if phase == .placing {
                    phase = .countdown
                    baseline = recent.sorted()[recent.count / 2]
                    countdown()
                }
            } else {
                phase = .placing
                show("Ne bouge plus", "Essai \(results.count + 1) sur \(trials)")
            }
        case .countdown:
            // le joueur bouge pendant le décompte : on recommence
            if body.isTracked && abs(y - baseline) > 0.06 { phase = .placing; show("Ne bouge plus", "Attends le « saute ! »") }
        case .flight:
            seen += 1
            if body.isTracked { tracked += 1; peak = max(peak, y) }
            if now - goAt > 3.0 { endTrial() }
        case .done:
            break
        }
    }

    private func countdown() {
        let steps: [(String, Double)] = [("3", 0), ("2", 1), ("1", 2), ("Saute !", 3)]
        for (text, delay) in steps {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self = self, self.phase == .countdown else { return }
                self.show(text)
                self.say(text == "Saute !" ? "Saute !" : text)
                if text == "Saute !" {
                    self.phase = .flight
                    self.goAt = CACurrentMediaTime()
                    self.peak = -.infinity
                    self.tracked = 0
                    self.seen = 0
                }
            }
        }
    }

    private func endTrial() {
        phase = .done
        let rise = (peak - baseline) * 100
        var value: Double? = nil
        var reason = ""
        if seen == 0 || Double(tracked) / Double(seen) < 0.6 { reason = "Je t'ai perdu de vue pendant le saut : reste bien dans l'image." }
        else if rise < 5 { reason = "Pas de saut détecté." }
        else if rise > 110 { reason = "Mesure incohérente : recule un peu et recommence." }
        else { value = (Double(rise) * 10).rounded() / 10 }
        results.append(value.map { $0 as Any } ?? NSNull())
        reasons.append(reason)
        if let v = value { show(String(format: "%.0f cm", v), "Essai \(results.count) sur \(trials)"); say(String(format: "%.0f centimètres", v)) }
        else { show("Essai non mesuré", reason); say("Essai non mesuré. \(reason)") }
        if results.count >= trials {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in self?.finish(cancelled: false) }
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
                guard let self = self else { return }
                self.history.removeAll()
                self.phase = .placing
                self.show("Reviens en place", "Essai \(self.results.count + 1) sur \(self.trials)")
                self.say("Reviens en place et ne bouge plus.")
            }
        }
    }

    private func finish(cancelled: Bool) {
        guard !finished else { return }
        finished = true
        phase = .done
        let out: [String: Any] = ["cancelled": cancelled, "trials": results, "reasons": reasons, "statureM": stature]
        dismiss(animated: true) { self.onDone(out) }
    }
}

// MARK: - Contrôleur Capacitor : enregistre le module

class PrepaBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PrepaVisionPlugin())
    }
}
