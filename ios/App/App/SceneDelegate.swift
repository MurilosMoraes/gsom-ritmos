import UIKit
import Capacitor
import AVFoundation

// ═══════════════════════════════════════════════════════════════════════
// CICLO DE VIDA DE CENAS (UIScene) — OBRIGATÓRIO A PARTIR DO iOS 26.
// ═══════════════════════════════════════════════════════════════════════
// A Apple rejeitou a 1.5.0 (build 71) com crash no lançamento em iPadOS 27:
//
//   _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption
//   EXC_BREAKPOINT / SIGTRAP, antes de qualquer código nosso rodar
//
// App compilado com o SDK novo e SEM UIApplicationSceneManifest no
// Info.plist é encerrado de propósito pelo UIKit. Não é bug do app.
//
// O QUE MUDA COM CENAS, e por que este arquivo existe:
//   - A janela passa a ser criada pela cena (o Info.plist aponta o
//     Main.storyboard, então o UIKit monta tudo sozinho).
//   - `application(_:open:)` e `application(_:continue:)` do AppDelegate
//     NÃO são mais chamados. Deep link (renovação, push) e link universal
//     chegam AQUI, e são repassados pro Capacitor pelo mesmo proxy de
//     sempre, senão o cliente que clica em "renovar" abre o app na home.
//   - `applicationDidBecomeActive` também não é chamado. Como é lá que o
//     AVAudioSession era reativado, isso vive aqui agora: sem isso o áudio
//     fica mudo depois de uma ligação ou de trocar de app.
// ═══════════════════════════════════════════════════════════════════════

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        // App aberto DIRETO por um link (frio): a URL vem aqui dentro, não
        // pelo openURLContexts. Sem isto, link de renovação com cupom abria
        // o app na home e a intenção do cliente se perdia.
        for contexto in connectionOptions.urlContexts {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared, open: contexto.url, options: [:]
            )
        }
        for atividade in connectionOptions.userActivities
        where atividade.activityType == NSUserActivityTypeBrowsingWeb {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared, continue: atividade, restorationHandler: { _ in }
            )
        }
    }

    /// Deep link com o app já aberto (gdrums://, push, link universal).
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for contexto in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared, open: contexto.url, options: [:]
            )
        }
    }

    /// Link universal (https://gdrums.com.br/...) com o app já aberto.
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared, continue: userActivity, restorationHandler: { _ in }
        )
    }

    /// Voltou pro primeiro plano: reativa o áudio.
    /// Era o `applicationDidBecomeActive` do AppDelegate, que com cenas
    /// não é mais chamado. iOS invalida a sessão em ligação, alarme, outro
    /// app tocando ou toggle do silencioso; sem reativar, o Web Audio fica
    /// sem saída e o app "não toca" no meio do show.
    func sceneDidBecomeActive(_ scene: UIScene) {
        do {
            let sessao = AVAudioSession.sharedInstance()
            try sessao.setCategory(.playback, mode: .default, options: [])
            try sessao.setActive(true, options: [])
        } catch {
            print("[GDrums] AVAudioSession reactivate failed: \(error)")
        }
    }
}
