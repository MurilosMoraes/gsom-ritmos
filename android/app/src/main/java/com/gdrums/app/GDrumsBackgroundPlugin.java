package com.gdrums.app;

import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge JS ↔ GDrumsAudioService.
 * JS chama:
 *   const GDrumsBackground = registerPlugin('GDrumsBackground');
 *   await GDrumsBackground.start();   // antes do play
 *   await GDrumsBackground.stop();    // ao parar definitivamente
 *
 * ── Por que tem controle de estado ────────────────────────────────────
 * Cada startForegroundService() abre um contrato com prazo no Android
 * (ver o comentário grande em GDrumsAudioService). Músico em show pisa no
 * pedal o tempo todo, e sem esse controle cada pisada abria um contrato
 * novo, inclusive com o serviço já de pé.
 *
 * Aqui a chamada repetida vira no-op: só fala com o sistema quando o
 * estado muda de verdade. Menos contrato aberto, menos chance de estourar
 * o prazo, e menos trabalho na thread principal no pior momento possível,
 * que é o instante em que o ritmo começa a tocar.
 */
@CapacitorPlugin(name = "GDrumsBackground")
public class GDrumsBackgroundPlugin extends Plugin {

    /** Estado desejado pelo app. Estático: o plugin é recriado, o serviço não. */
    private static boolean ligado = false;

    @PluginMethod
    public void start(PluginCall call) {
        if (ligado) { call.resolve(); return; }   // já de pé: não abre contrato novo
        Intent intent = new Intent(getContext(), GDrumsAudioService.class);
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            ligado = true;
            call.resolve();
        } catch (Exception e) {
            // Android 12+ recusa início vindo do background. Não é motivo
            // pra quebrar o play: o app toca normal com a tela ligada.
            ligado = false;
            call.resolve();
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (!ligado) { call.resolve(); return; }
        ligado = false;

        // NÃO use stopService() aqui. Ele pode matar o serviço antes dele
        // nascer, deixando pendente o contrato aberto pelo start, e o
        // Android derruba o app. Ver ACAO_PARAR em GDrumsAudioService.
        Intent intent = new Intent(getContext(), GDrumsAudioService.class);
        intent.setAction(GDrumsAudioService.ACAO_PARAR);
        try {
            ContextCompat.startForegroundService(getContext(), intent);
        } catch (Exception e) {
            // ignora: desligar o serviço nunca pode derrubar o app
        }
        call.resolve();
    }
}
