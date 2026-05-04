// ═════════════════════════════════════════════════════════════════════════
// GDrumsViewController — subclasse de CAPBridgeViewController que registra
// plugins custom (in-app, não SPM/CocoaPods) no Capacitor 8.
// ═════════════════════════════════════════════════════════════════════════
//
// Capacitor 8 NÃO auto-registra plugins definidos dentro do app target.
// Auto-discovery via @objc só funciona pra plugins em Swift Package /
// CocoaPods externo. Pra plugins in-app é OBRIGATÓRIO chamar
// bridge?.registerPluginInstance() em capacitorDidLoad().
//
// Sem isso, JS chama registerPlugin('GDrumsAudioEngine') → Capacitor procura
// → não acha → "plugin não respondeu" → NativeAudioEngine cai em
// handleInitFailure → app fica sem áudio nativo.
//
// Esse arquivo é referenciado no Main.storyboard como Custom Class do
// initial view controller (substitui o default CAPBridgeViewController).
//
// Ref: https://capacitorjs.com/docs/ios/custom-code
//      https://github.com/ionic-team/capacitor/discussions/8402

import UIKit
import Capacitor

class GDrumsViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GDrumsAudioEnginePlugin())
        bridge?.registerPluginInstance(GDrumsNowPlayingPlugin())
    }
}
