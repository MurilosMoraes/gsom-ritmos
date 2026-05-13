import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // ═══════════════════════════════════════════════════════════════
        // BACKGROUND AUDIO — categoria .playback no AVAudioSession.
        // ═══════════════════════════════════════════════════════════════
        // Sem isso, WKWebView pausa o AudioContext do Web Audio quando
        // o app perde foreground (mesmo com UIBackgroundModes=audio).
        // .playback = continua tocando com tela bloqueada e em outro app.
        // .mixWithOthers = não interrompe Spotify/podcast do user.
        //
        // Combinado com `navigator.audioSession.type = 'playback'` no JS,
        // resolve o gap histórico do bug WebKit 261554 (resolved iOS 17.5)
        // que tratava Web Audio como "ambient" e cortava em background.
        //
        // Também escuta interrupções (ligação, alarme) e retoma sozinho.
        // ═══════════════════════════════════════════════════════════════
        do {
            let session = AVAudioSession.sharedInstance()
            // .playback exclusivo (sem options): bypassa o switch silencioso
            // do iOS (Ring/Silent toggle no lateral) E permite NowPlaying no
            // lock screen / control center.
            //
            // Histórico: tínhamos .mixWithOthers pra coexistir com Spotify,
            // mas relatos de usuários (e doc Apple confirma) mostram que essa
            // opção pode fazer a session ser tratada como secundária em iOS
            // recentes, respeitando silent switch — sintoma: app instalado
            // pedia pra desativar silencioso pra tocar.
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true, options: [])
        } catch {
            print("[GDrums] AVAudioSession setup failed: \(error)")
        }

        // Recovery automático em interrupção (ligação telefônica, etc)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance()
        )

        return true
    }

    @objc func handleAudioInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

        if type == .ended {
            // Interrupção terminou — reativar session pra Web Audio voltar
            do {
                try AVAudioSession.sharedInstance().setActive(true, options: [])
            } catch {
                print("[GDrums] Failed to reactivate audio session: \(error)")
            }
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Re-ativa AVAudioSession sempre que o app voltar pro foreground.
        // iOS pode invalidar a session em vários cenários (ligação, outro app
        // tocando áudio, switch silencioso toggled). Forçar setActive(true)
        // aqui garante que Web Audio sempre tem output válido.
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true, options: [])
            print("[GDrums] AVAudioSession reactivated on becomeActive")
        } catch {
            print("[GDrums] AVAudioSession reactivate failed: \(error)")
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
