// ═════════════════════════════════════════════════════════════════════════
// GDrumsNowPlayingPlugin — integração lockscreen iOS via MPNowPlayingInfoCenter
// + MPRemoteCommandCenter. Faz o app aparecer no lockscreen, Control Center,
// AirPods controls e Bluetooth car deck igual Spotify.
// ═════════════════════════════════════════════════════════════════════════
//
// API exposta pro JS:
//  - update(title, subtitle, bpm)   → atualiza Now Playing card
//  - setPlaybackState(playing)      → sinaliza play/pause pro SO
//  - clear()                        → remove card
//
// Eventos enviados pro JS via notifyListeners:
//  - 'remotePlay'      → user tocou play no lockscreen
//  - 'remotePause'     → user tocou pause no lockscreen
//  - 'remoteNext'      → user pediu próximo (mapeia pra próximo do setlist)
//  - 'remotePrevious'  → user pediu anterior

import Foundation
import Capacitor
import MediaPlayer

@objc(GDrumsNowPlayingPlugin)
public class GDrumsNowPlayingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GDrumsNowPlayingPlugin"
    public let jsName = "GDrumsNowPlaying"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPlaybackState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    private var commandsRegistered = false

    // ─── Lifecycle ────────────────────────────────────────────────────────

    public override func load() {
        super.load()
        registerRemoteCommands()
    }

    /// Registra handlers pros botões do lockscreen/Control Center/AirPods.
    /// Cada handler dispara um evento JS via notifyListeners — o TS decide
    /// o que fazer (play, pause, próximo do setlist, etc).
    private func registerRemoteCommands() {
        guard !commandsRegistered else { return }
        commandsRegistered = true

        let cc = MPRemoteCommandCenter.shared()

        cc.playCommand.isEnabled = true
        cc.playCommand.addTarget { [weak self] _ in
            self?.notifyListeners("remotePlay", data: [:])
            return .success
        }

        cc.pauseCommand.isEnabled = true
        cc.pauseCommand.addTarget { [weak self] _ in
            self?.notifyListeners("remotePause", data: [:])
            return .success
        }

        cc.togglePlayPauseCommand.isEnabled = true
        cc.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.notifyListeners("remoteToggle", data: [:])
            return .success
        }

        cc.nextTrackCommand.isEnabled = true
        cc.nextTrackCommand.addTarget { [weak self] _ in
            self?.notifyListeners("remoteNext", data: [:])
            return .success
        }

        cc.previousTrackCommand.isEnabled = true
        cc.previousTrackCommand.addTarget { [weak self] _ in
            self?.notifyListeners("remotePrevious", data: [:])
            return .success
        }

        // Disable commands não usados pra UI ficar limpa
        cc.skipForwardCommand.isEnabled = false
        cc.skipBackwardCommand.isEnabled = false
        cc.seekForwardCommand.isEnabled = false
        cc.seekBackwardCommand.isEnabled = false
        cc.changePlaybackPositionCommand.isEnabled = false
    }

    // ─── Plugin methods ────────────────────────────────────────────────────

    @objc public func update(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "GDrums"
        let subtitle = call.getString("subtitle") ?? ""
        let bpm = call.getInt("bpm") ?? 0

        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = title
        info[MPMediaItemPropertyArtist] = "GDrums"
        info[MPMediaItemPropertyAlbumTitle] = bpm > 0 ? "\(bpm) BPM • \(subtitle)" : subtitle

        // Artwork: usa o ícone do app
        if let icon = UIImage(named: "AppIcon60x60") ?? UIImage(named: "AppIcon") {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: icon.size) { _ in icon }
        }

        // Playback rate 1.0 = playing; será atualizado por setPlaybackState
        info[MPNowPlayingInfoPropertyPlaybackRate] = 1.0
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = 1.0
        // Sem duração definida = "live" (sequencer rodando indefinidamente)
        info[MPMediaItemPropertyPlaybackDuration] = 0
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = 0

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        call.resolve()
    }

    @objc public func setPlaybackState(_ call: CAPPluginCall) {
        let playing = call.getBool("playing") ?? false
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        call.resolve()
    }

    @objc public func clear(_ call: CAPPluginCall) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        call.resolve()
    }
}
