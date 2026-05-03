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
 */
@CapacitorPlugin(name = "GDrumsBackground")
public class GDrumsBackgroundPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Intent intent = new Intent(getContext(), GDrumsAudioService.class);
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Falha ao iniciar service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), GDrumsAudioService.class);
        try {
            getContext().stopService(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Falha ao parar service: " + e.getMessage());
        }
    }
}
