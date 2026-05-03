package com.gdrums.app.audio;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Comparator;
import java.util.PriorityQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * GDrumsAudioEngineCore — engine de áudio nativo Android.
 *
 * Filosofia: ZERO gap em background, sample-accurate scheduling, lockscreen
 * integrado igual Spotify. AudioTrack em MODE_STREAM com mixer custom Java
 * roda no audio thread separado, fora do alcance do GC do WebView.
 *
 * Combinado com o ForegroundService (já existente) + MediaSession, deixa o
 * Android tratar o app como media player legítimo: sem suspensão, lockscreen
 * widget visível, controles funcionais.
 *
 * MVP em Java puro (sem NDK/Oboe). Latência típica 15-25ms — aceitável pra
 * músico em palco. Migração pra Oboe pode ser feita depois se hardware
 * entry-level cuspir glitches.
 *
 * API espelha o GDrumsAudioEngineCore.swift:
 *  - initialize()
 *  - loadSample(key, assetPath)
 *  - anchorNow(leadInMs)
 *  - scheduleSample(channel, key, offsetSec, volume)
 *  - cancelChannel(channel)
 *  - cancelAll()
 *  - setMasterVolume(vol)
 *  - currentTimeSinceAnchor()
 */
public class GDrumsAudioEngineCore {
    private static final String TAG = "GDrumsAudioEngine";
    private static final int SAMPLE_RATE = 48000;
    private static final int CHANNELS = 12;
    /** 240 frames @ 48k = 5ms — alvo de baixa latência. */
    private static final int BUFFER_FRAMES = 240;
    /** Fade out em frames (5ms = 240 frames @ 48k) — evita clique no cancel. */
    private static final int FADE_OUT_FRAMES = 240;

    // Singleton instance
    private static volatile GDrumsAudioEngineCore instance;
    public static GDrumsAudioEngineCore get(Context context) {
        if (instance == null) {
            synchronized (GDrumsAudioEngineCore.class) {
                if (instance == null) instance = new GDrumsAudioEngineCore(context.getApplicationContext());
            }
        }
        return instance;
    }

    private final Context appContext;
    private final ConcurrentHashMap<String, short[]> sampleCache = new ConcurrentHashMap<>();
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicLong totalFramesRendered = new AtomicLong(0);
    private final AtomicLong anchorFrame = new AtomicLong(-1);
    private volatile float masterVolume = 1f;

    private AudioTrack audioTrack;
    private Thread renderThread;

    /** Eventos agendados ordenados por frameTime absoluto. */
    private static class ScheduledEvent {
        final long frameTime;
        final int channel;
        final String sampleKey;
        final float volume;
        ScheduledEvent(long frameTime, int channel, String sampleKey, float volume) {
            this.frameTime = frameTime;
            this.channel = channel;
            this.sampleKey = sampleKey;
            this.volume = volume;
        }
    }
    private final PriorityQueue<ScheduledEvent> scheduleQueue =
        new PriorityQueue<>(64, Comparator.comparingLong(e -> e.frameTime));
    private final Object scheduleLock = new Object();

    /** Estado de cada canal — qual sample tá tocando, posição, volume, fade. */
    private static class ChannelState {
        short[] sample;
        int positionFrames;  // negativo = espera N frames pra começar
        float volume;
        int fadeOutRemaining;  // > 0 = aplicando fade de saída
    }
    private final ChannelState[] channels = new ChannelState[CHANNELS];

    private GDrumsAudioEngineCore(Context context) {
        this.appContext = context;
        for (int i = 0; i < CHANNELS; i++) {
            channels[i] = new ChannelState();
        }
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────

    public synchronized void initialize() {
        if (running.get()) return;

        int minBuffer = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_STEREO,
            AudioFormat.ENCODING_PCM_16BIT
        );
        int bufferBytes = Math.max(minBuffer, BUFFER_FRAMES * 2 * 2); // *2ch *2bytes

        AudioTrack.Builder builder = new AudioTrack.Builder()
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build())
            .setAudioFormat(new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                .build())
            .setBufferSizeInBytes(bufferBytes)
            .setTransferMode(AudioTrack.MODE_STREAM);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY);
        }
        audioTrack = builder.build();
        audioTrack.play();

        running.set(true);
        totalFramesRendered.set(0);
        anchorFrame.set(-1);

        renderThread = new Thread(this::renderLoop, "GDrumsAudioRender");
        renderThread.setPriority(Thread.MAX_PRIORITY);
        renderThread.setDaemon(true);
        renderThread.start();

        Log.i(TAG, "Started @ " + SAMPLE_RATE + "Hz, " + CHANNELS + " channels");
    }

    public synchronized void shutdown() {
        if (!running.getAndSet(false)) return;
        try { if (renderThread != null) renderThread.join(500); } catch (InterruptedException ignored) {}
        if (audioTrack != null) {
            try { audioTrack.stop(); } catch (Exception ignored) {}
            try { audioTrack.release(); } catch (Exception ignored) {}
            audioTrack = null;
        }
        synchronized (scheduleLock) { scheduleQueue.clear(); }
        synchronized (channels) {
            for (ChannelState ch : channels) {
                ch.sample = null;
                ch.positionFrames = 0;
                ch.fadeOutRemaining = 0;
            }
        }
    }

    public boolean isReady() { return running.get(); }
    public int getSampleRate() { return SAMPLE_RATE; }

    // ─── Sample loading ──────────────────────────────────────────────────

    /**
     * Carrega sample dos assets (Capacitor copia /public pra assets/public).
     * @param key chave pra cache (ex: "/midi/bumbo.wav")
     * @param assetPath caminho relativo a assets/ (ex: "public/midi/bumbo.wav")
     */
    public boolean loadSample(String key, String assetPath) {
        if (sampleCache.containsKey(key)) return true;
        try {
            // Copia asset pra cache file (MediaExtractor exige path real ou FD)
            File cacheFile = new File(appContext.getCacheDir(), assetPath.replace("/", "_"));
            if (!cacheFile.exists()) {
                try (InputStream in = appContext.getAssets().open(assetPath);
                     FileOutputStream out = new FileOutputStream(cacheFile)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
            }
            short[] pcm = decodeToPcmMono48k(cacheFile);
            if (pcm == null) return false;
            sampleCache.put(key, pcm);
            return true;
        } catch (Exception e) {
            Log.e(TAG, "loadSample falhou " + assetPath, e);
            return false;
        }
    }

    public boolean isSampleLoaded(String key) {
        return sampleCache.containsKey(key);
    }

    /** Decodifica WAV/MP3 pra PCM 16-bit mono 48k (resample linear se preciso). */
    private short[] decodeToPcmMono48k(File file) {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec codec = null;
        try {
            extractor.setDataSource(file.getAbsolutePath());
            int trackIdx = -1;
            MediaFormat format = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat f = extractor.getTrackFormat(i);
                String mime = f.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    trackIdx = i;
                    format = f;
                    break;
                }
            }
            if (trackIdx < 0 || format == null) return null;
            extractor.selectTrack(trackIdx);

            int srcSampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int srcChannels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            String mime = format.getString(MediaFormat.KEY_MIME);

            codec = MediaCodec.createDecoderByType(mime);
            codec.configure(format, null, null, 0);
            codec.start();

            // Acumulador dinâmico
            int initialCapacity = (int) (srcSampleRate * 5); // estimativa 5s
            short[] accum = new short[initialCapacity];
            int accumLen = 0;

            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            boolean inputDone = false;
            boolean outputDone = false;

            while (!outputDone) {
                if (!inputDone) {
                    int inIdx = codec.dequeueInputBuffer(10_000);
                    if (inIdx >= 0) {
                        ByteBuffer inBuf = codec.getInputBuffer(inIdx);
                        if (inBuf == null) continue;
                        int sampleSize = extractor.readSampleData(inBuf, 0);
                        if (sampleSize < 0) {
                            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            codec.queueInputBuffer(inIdx, 0, sampleSize, extractor.getSampleTime(), 0);
                            extractor.advance();
                        }
                    }
                }
                int outIdx = codec.dequeueOutputBuffer(info, 10_000);
                if (outIdx >= 0) {
                    ByteBuffer outBuf = codec.getOutputBuffer(outIdx);
                    if (outBuf != null && info.size > 0) {
                        outBuf.position(info.offset);
                        outBuf.limit(info.offset + info.size);
                        short[] chunk = new short[info.size / 2];
                        outBuf.order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(chunk);

                        // Downmix pra mono se stereo
                        short[] mono;
                        if (srcChannels == 2) {
                            mono = new short[chunk.length / 2];
                            for (int i = 0, j = 0; j < mono.length; i += 2, j++) {
                                mono[j] = (short) ((chunk[i] + chunk[i + 1]) / 2);
                            }
                        } else {
                            mono = chunk;
                        }

                        // Garante capacidade
                        if (accumLen + mono.length > accum.length) {
                            short[] bigger = new short[Math.max(accum.length * 2, accumLen + mono.length)];
                            System.arraycopy(accum, 0, bigger, 0, accumLen);
                            accum = bigger;
                        }
                        System.arraycopy(mono, 0, accum, accumLen, mono.length);
                        accumLen += mono.length;
                    }
                    codec.releaseOutputBuffer(outIdx, false);
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true;
                }
            }
            short[] decoded = new short[accumLen];
            System.arraycopy(accum, 0, decoded, 0, accumLen);

            // Resample linear pra 48k se necessário
            if (srcSampleRate != SAMPLE_RATE) {
                decoded = linearResample(decoded, srcSampleRate, SAMPLE_RATE);
            }
            return decoded;
        } catch (Exception e) {
            Log.e(TAG, "decode falhou", e);
            return null;
        } finally {
            try { if (codec != null) { codec.stop(); codec.release(); } } catch (Exception ignored) {}
            try { extractor.release(); } catch (Exception ignored) {}
        }
    }

    private short[] linearResample(short[] input, int srcRate, int dstRate) {
        if (srcRate == dstRate) return input;
        double ratio = (double) srcRate / dstRate;
        int outLen = (int) (input.length / ratio);
        short[] out = new short[outLen];
        for (int i = 0; i < outLen; i++) {
            double srcIdx = i * ratio;
            int i0 = Math.min((int) srcIdx, input.length - 1);
            int i1 = Math.min(i0 + 1, input.length - 1);
            float frac = (float) (srcIdx - i0);
            out[i] = (short) (input[i0] * (1 - frac) + input[i1] * frac);
        }
        return out;
    }

    // ─── Scheduling ────────────────────────────────────────────────────────

    /** Marca tempo zero do sequenciador. leadInMs = margem pra agendar futuro. */
    public void anchorNow(double leadInMs) {
        long lead = (long) (leadInMs / 1000.0 * SAMPLE_RATE);
        anchorFrame.set(totalFramesRendered.get() + lead);
    }

    /** Agenda sample no canal a tocar offsetSeconds APÓS o anchor. */
    public void scheduleSample(int channel, String sampleKey, double offsetSeconds, float volume) {
        if (!running.get() || channel < 0 || channel >= CHANNELS) return;
        long anchor = anchorFrame.get();
        if (anchor < 0) {
            playOneShotImmediate(channel, sampleKey, volume);
            return;
        }
        if (!sampleCache.containsKey(sampleKey)) {
            Log.w(TAG, "Sample não carregado: " + sampleKey);
            return;
        }
        long offsetFrames = (long) (offsetSeconds * SAMPLE_RATE);
        long when = anchor + offsetFrames;
        synchronized (scheduleLock) {
            scheduleQueue.add(new ScheduledEvent(when, channel, sampleKey, volume));
        }
    }

    public void playOneShotImmediate(int channel, String sampleKey, float volume) {
        if (!running.get() || channel < 0 || channel >= CHANNELS) return;
        long when = totalFramesRendered.get() + BUFFER_FRAMES; // próxima janela
        synchronized (scheduleLock) {
            scheduleQueue.add(new ScheduledEvent(when, channel, sampleKey, volume));
        }
    }

    public void cancelChannel(int channel) {
        if (channel < 0 || channel >= CHANNELS) return;
        synchronized (scheduleLock) {
            scheduleQueue.removeIf(e -> e.channel == channel);
        }
        synchronized (channels) {
            ChannelState ch = channels[channel];
            if (ch.sample != null) ch.fadeOutRemaining = FADE_OUT_FRAMES;
        }
    }

    public void cancelAll() {
        synchronized (scheduleLock) { scheduleQueue.clear(); }
        synchronized (channels) {
            for (ChannelState ch : channels) {
                if (ch.sample != null) ch.fadeOutRemaining = FADE_OUT_FRAMES;
            }
        }
    }

    public void setMasterVolume(float vol) {
        masterVolume = Math.max(0f, Math.min(2f, vol));
    }

    public double currentTimeSinceAnchor() {
        long anchor = anchorFrame.get();
        if (anchor < 0) return -1;
        return (totalFramesRendered.get() - anchor) / (double) SAMPLE_RATE;
    }

    // ─── Render loop (audio thread) ───────────────────────────────────────

    private void renderLoop() {
        float[] frameBuf = new float[BUFFER_FRAMES];
        short[] outBuf = new short[BUFFER_FRAMES * 2];

        while (running.get()) {
            // 1. Promove eventos cujo tempo chegou
            synchronized (scheduleLock) {
                long currentTime = totalFramesRendered.get();
                while (!scheduleQueue.isEmpty() && scheduleQueue.peek().frameTime < currentTime + BUFFER_FRAMES) {
                    ScheduledEvent ev = scheduleQueue.poll();
                    if (ev == null) continue;
                    short[] sample = sampleCache.get(ev.sampleKey);
                    if (sample == null) continue;
                    synchronized (channels) {
                        ChannelState ch = channels[ev.channel];
                        ch.sample = sample;
                        // offset dentro do buffer atual
                        int offsetInBuf = (int) Math.max(0, ev.frameTime - currentTime);
                        ch.positionFrames = -offsetInBuf;
                        ch.volume = ev.volume;
                        ch.fadeOutRemaining = 0;
                    }
                }
            }

            // 2. Limpa accumulator
            for (int i = 0; i < frameBuf.length; i++) frameBuf[i] = 0f;

            // 3. Mixa cada canal
            synchronized (channels) {
                for (ChannelState ch : channels) {
                    if (ch.sample == null) continue;
                    short[] s = ch.sample;
                    for (int i = 0; i < BUFFER_FRAMES; i++) {
                        if (ch.positionFrames < 0) { ch.positionFrames++; continue; }
                        if (ch.positionFrames >= s.length) { ch.sample = null; break; }
                        float v = (s[ch.positionFrames] / 32768f) * ch.volume;
                        if (ch.fadeOutRemaining > 0) {
                            v *= ch.fadeOutRemaining / (float) FADE_OUT_FRAMES;
                            ch.fadeOutRemaining--;
                            if (ch.fadeOutRemaining == 0) { ch.sample = null; break; }
                        }
                        frameBuf[i] += v;
                        ch.positionFrames++;
                    }
                }
            }

            // 4. Master + clamp + interleave stereo
            float mv = masterVolume;
            for (int i = 0; i < BUFFER_FRAMES; i++) {
                float v = frameBuf[i] * mv * 32767f;
                if (v > 32767f) v = 32767f;
                if (v < -32768f) v = -32768f;
                short s = (short) v;
                outBuf[i * 2] = s;
                outBuf[i * 2 + 1] = s;
            }

            // 5. Escreve no AudioTrack (blocking — sincroniza thread com hardware)
            int written = audioTrack.write(outBuf, 0, outBuf.length);
            if (written > 0) {
                totalFramesRendered.addAndGet(BUFFER_FRAMES);
            } else if (written < 0) {
                Log.e(TAG, "AudioTrack.write erro: " + written);
                break;
            }
        }
    }
}
