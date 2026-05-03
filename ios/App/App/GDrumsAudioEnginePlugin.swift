// ═════════════════════════════════════════════════════════════════════════
// GDrumsAudioEnginePlugin — plugin Capacitor pro engine de áudio nativo iOS.
// ═════════════════════════════════════════════════════════════════════════
//
// FASE 0 (atual): apenas ping() pra validar pipeline TS↔nativo.
// FASE 1: AVAudioEngine + 12 PlayerNodes + scheduleSample sample-accurate.
// FASE 2-3: Pattern transitions, MediaSession, etc.
//
// Padrão Capacitor: classe herda Plugin, anotada com @objc.
// Métodos expostos pro JS são @objc func name(_ call: CAPPluginCall).

import Foundation
import Capacitor

@objc(GDrumsAudioEnginePlugin)
public class GDrumsAudioEnginePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GDrumsAudioEnginePlugin"
    public let jsName = "GDrumsAudioEngine"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ping", returnType: CAPPluginReturnPromise),
    ]

    @objc public func ping(_ call: CAPPluginCall) {
        let info: [String: Any] = [
            "platform": "ios",
            "version": "0.1.0-fase0",
            "ready": true,
        ]
        call.resolve(info)
    }
}
