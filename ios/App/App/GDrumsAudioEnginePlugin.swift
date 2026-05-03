// ═════════════════════════════════════════════════════════════════════════
// GDrumsAudioEnginePlugin — bridge JS↔nativo pro engine de áudio iOS.
// ═════════════════════════════════════════════════════════════════════════
//
// Expõe métodos do GDrumsAudioEngineCore (AVAudioEngine) pro TypeScript
// via Capacitor. Cada método valida args, chama o core, retorna resolve/reject.
//
// Padrão Capacitor 8: classe herda CAPPlugin + CAPBridgedPlugin, métodos são
// @objc func name(_ call: CAPPluginCall).

import Foundation
import Capacitor

@objc(GDrumsAudioEnginePlugin)
public class GDrumsAudioEnginePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GDrumsAudioEnginePlugin"
    public let jsName = "GDrumsAudioEngine"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ping", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadSample", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isSampleLoaded", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "anchorNow", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleSample", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playOneShot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelChannel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMasterVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentTime", returnType: CAPPluginReturnPromise),
    ]

    private var core: GDrumsAudioEngineCore { GDrumsAudioEngineCore.shared }

    // ─── Sanity ────────────────────────────────────────────────────────────

    @objc public func ping(_ call: CAPPluginCall) {
        call.resolve([
            "platform": "ios",
            "version": "0.2.0-fase1",
            "ready": core.ready,
            "sampleRate": core.sampleRate,
        ])
    }

    @objc public func initialize(_ call: CAPPluginCall) {
        core.initialize()
        call.resolve([
            "ready": core.ready,
            "sampleRate": core.sampleRate,
        ])
    }

    // ─── Sample loading ────────────────────────────────────────────────────

    @objc public func loadSample(_ call: CAPPluginCall) {
        guard let key = call.getString("key"),
              let bundlePath = call.getString("bundlePath") else {
            call.reject("loadSample requer 'key' e 'bundlePath'")
            return
        }
        let success = core.loadSample(key: key, bundlePath: bundlePath)
        if success {
            call.resolve(["loaded": true])
        } else {
            call.reject("Falha ao carregar sample: \(bundlePath)")
        }
    }

    @objc public func isSampleLoaded(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("isSampleLoaded requer 'key'")
            return
        }
        call.resolve(["loaded": core.isSampleLoaded(key: key)])
    }

    // ─── Scheduling ────────────────────────────────────────────────────────

    @objc public func anchorNow(_ call: CAPPluginCall) {
        let leadInMs = call.getDouble("leadInMs") ?? 50.0
        core.anchorNow(leadInMs: leadInMs)
        call.resolve()
    }

    @objc public func scheduleSample(_ call: CAPPluginCall) {
        guard let channel = call.getInt("channel"),
              let key = call.getString("key"),
              let offsetSeconds = call.getDouble("offsetSeconds") else {
            call.reject("scheduleSample requer 'channel', 'key', 'offsetSeconds'")
            return
        }
        let volume = Float(call.getDouble("volume") ?? 1.0)
        core.scheduleSample(channel: channel, sampleKey: key, offsetSeconds: offsetSeconds, volume: volume)
        call.resolve()
    }

    @objc public func playOneShot(_ call: CAPPluginCall) {
        guard let channel = call.getInt("channel"),
              let key = call.getString("key") else {
            call.reject("playOneShot requer 'channel' e 'key'")
            return
        }
        let volume = Float(call.getDouble("volume") ?? 1.0)
        core.playOneShotImmediate(channel: channel, sampleKey: key, volume: volume)
        call.resolve()
    }

    // ─── Cancelamento ──────────────────────────────────────────────────────

    @objc public func cancelChannel(_ call: CAPPluginCall) {
        guard let channel = call.getInt("channel") else {
            call.reject("cancelChannel requer 'channel'")
            return
        }
        core.cancelChannel(channel)
        call.resolve()
    }

    @objc public func cancelAll(_ call: CAPPluginCall) {
        core.cancelAll()
        call.resolve()
    }

    // ─── Master volume + clock ─────────────────────────────────────────────

    @objc public func setMasterVolume(_ call: CAPPluginCall) {
        guard let volume = call.getDouble("volume") else {
            call.reject("setMasterVolume requer 'volume'")
            return
        }
        core.setMasterVolume(Float(volume))
        call.resolve()
    }

    @objc public func currentTime(_ call: CAPPluginCall) {
        call.resolve(["seconds": core.currentTimeSinceAnchor()])
    }
}
