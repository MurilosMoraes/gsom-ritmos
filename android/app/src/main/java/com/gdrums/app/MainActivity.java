package com.gdrums.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registrar plugins nativos. Tem que ser ANTES de super.onCreate()
        // pra Capacitor saber dos plugins quando o WebView carregar.
        registerPlugin(GDrumsBackgroundPlugin.class);
        registerPlugin(GDrumsAudioEnginePlugin.class);
        // Edge-to-edge é gerenciado pelo plugin @capawesome/capacitor-android-edge-to-edge-support
        // — ele popula env(safe-area-inset-*) corretamente em top E bottom, sem
        // header fantasma e sem mexer no keyboard.
        super.onCreate(savedInstanceState);
    }
}
