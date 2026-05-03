package com.gdrums.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * GDrumsAudioEnginePlugin — bridge JS↔nativo pro engine de áudio Android.
 *
 * FASE 0 (atual): apenas ping() pra validar pipeline TS↔nativo.
 * FASE 2: AudioTrack mixer Kotlin + sample-accurate scheduling.
 * FASE 3-4: Pattern transitions, MediaSession integrado.
 *
 * Registrado em MainActivity.onCreate via registerPlugin().
 */
@CapacitorPlugin(name = "GDrumsAudioEngine")
public class GDrumsAudioEnginePlugin extends Plugin {

    @PluginMethod
    public void ping(PluginCall call) {
        JSObject info = new JSObject();
        info.put("platform", "android");
        info.put("version", "0.1.0-fase0");
        info.put("ready", true);
        call.resolve(info);
    }
}
