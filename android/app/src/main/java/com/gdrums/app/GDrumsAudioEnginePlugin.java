package com.gdrums.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.gdrums.app.audio.GDrumsAudioEngineCore;

/**
 * GDrumsAudioEnginePlugin — bridge JS↔nativo pro engine de áudio Android.
 *
 * Expõe métodos do GDrumsAudioEngineCore (AudioTrack mixer Java) pro
 * TypeScript via Capacitor. API espelha o GDrumsAudioEnginePlugin.swift.
 */
@CapacitorPlugin(name = "GDrumsAudioEngine")
public class GDrumsAudioEnginePlugin extends Plugin {

    private GDrumsAudioEngineCore core() {
        return GDrumsAudioEngineCore.get(getContext());
    }

    @PluginMethod
    public void ping(PluginCall call) {
        JSObject info = new JSObject();
        info.put("platform", "android");
        info.put("version", "0.2.0-fase2");
        info.put("ready", core().isReady());
        info.put("sampleRate", core().getSampleRate());
        call.resolve(info);
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        core().initialize();
        JSObject info = new JSObject();
        info.put("ready", core().isReady());
        info.put("sampleRate", core().getSampleRate());
        call.resolve(info);
    }

    @PluginMethod
    public void loadSample(PluginCall call) {
        String key = call.getString("key");
        // Android usa assetPath em vez de bundlePath (Capacitor copia /public pra assets/public)
        String assetPath = call.getString("assetPath");
        if (assetPath == null) assetPath = call.getString("bundlePath");  // compat
        if (key == null || assetPath == null) {
            call.reject("loadSample requer 'key' e 'assetPath'");
            return;
        }
        boolean ok = core().loadSample(key, assetPath);
        if (ok) {
            JSObject r = new JSObject();
            r.put("loaded", true);
            call.resolve(r);
        } else {
            call.reject("Falha ao carregar sample: " + assetPath);
        }
    }

    @PluginMethod
    public void isSampleLoaded(PluginCall call) {
        String key = call.getString("key");
        if (key == null) { call.reject("requer 'key'"); return; }
        JSObject r = new JSObject();
        r.put("loaded", core().isSampleLoaded(key));
        call.resolve(r);
    }

    @PluginMethod
    public void anchorNow(PluginCall call) {
        Double leadInMs = call.getDouble("leadInMs");
        core().anchorNow(leadInMs != null ? leadInMs : 50.0);
        call.resolve();
    }

    @PluginMethod
    public void scheduleSample(PluginCall call) {
        Integer channel = call.getInt("channel");
        String key = call.getString("key");
        Double offsetSeconds = call.getDouble("offsetSeconds");
        Double volume = call.getDouble("volume");
        if (channel == null || key == null || offsetSeconds == null) {
            call.reject("scheduleSample requer 'channel', 'key', 'offsetSeconds'");
            return;
        }
        core().scheduleSample(channel, key, offsetSeconds, volume != null ? volume.floatValue() : 1f);
        call.resolve();
    }

    @PluginMethod
    public void playOneShot(PluginCall call) {
        Integer channel = call.getInt("channel");
        String key = call.getString("key");
        Double volume = call.getDouble("volume");
        if (channel == null || key == null) {
            call.reject("playOneShot requer 'channel' e 'key'");
            return;
        }
        core().playOneShotImmediate(channel, key, volume != null ? volume.floatValue() : 1f);
        call.resolve();
    }

    @PluginMethod
    public void cancelChannel(PluginCall call) {
        Integer channel = call.getInt("channel");
        if (channel == null) { call.reject("requer 'channel'"); return; }
        core().cancelChannel(channel);
        call.resolve();
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        core().cancelAll();
        call.resolve();
    }

    @PluginMethod
    public void setMasterVolume(PluginCall call) {
        Double volume = call.getDouble("volume");
        if (volume == null) { call.reject("requer 'volume'"); return; }
        core().setMasterVolume(volume.floatValue());
        call.resolve();
    }

    @PluginMethod
    public void currentTime(PluginCall call) {
        JSObject r = new JSObject();
        r.put("seconds", core().currentTimeSinceAnchor());
        call.resolve(r);
    }
}
