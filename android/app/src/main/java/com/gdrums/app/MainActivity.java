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
        super.onCreate(savedInstanceState);
    }
}
