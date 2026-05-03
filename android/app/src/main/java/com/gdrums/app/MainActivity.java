package com.gdrums.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registrar plugin nativo de background audio (ForegroundService).
        // Tem que ser ANTES de super.onCreate() pra Capacitor saber do plugin
        // quando o WebView carregar.
        registerPlugin(GDrumsBackgroundPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
