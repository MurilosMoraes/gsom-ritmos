package com.gdrums.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

/**
 * ForegroundService que mantém o app vivo em background pro Web Audio API
 * continuar tocando com tela bloqueada / em outro app.
 *
 * Sem isso:
 * - Chromium WebView throttle setTimeout em bg → Scheduler para de agendar
 * - Android pode matar o processo por OOM ou bateria
 * - AudioContext fica suspenso
 *
 * Com isso:
 * - Notification persistente "GDrums tocando" com Pause/Stop
 * - SO trata o app como "media player" → não suspende, não throttle agressivo
 * - MediaSession integrada → aparece em lockscreen + Bluetooth car deck
 *
 * Ciclo: JS chama plugin start → cria service → user para ou app é fechado
 * → JS chama plugin stop → service para → notification some.
 */
public class GDrumsAudioService extends Service {
    private static final String CHANNEL_ID = "gdrums_playback";
    private static final int NOTIFICATION_ID = 1042;
    private MediaSessionCompat mediaSession;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        mediaSession = new MediaSessionCompat(this, "GDrumsSession");
        mediaSession.setPlaybackState(
            new PlaybackStateCompat.Builder()
                .setState(PlaybackStateCompat.STATE_PLAYING, 0, 1f)
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY_PAUSE
                    | PlaybackStateCompat.ACTION_STOP
                )
                .build()
        );
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Intent pra abrir o app quando user clica na notification
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("GDrums")
            .setContentText("Tocando ritmo")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setStyle(new MediaStyle().setMediaSession(mediaSession.getSessionToken()))
            .setOngoing(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();

        // Android 14 (API 34+): foregroundServiceType OBRIGATÓRIO.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // START_STICKY: SO recria o service se for matado, mantendo áudio
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "GDrums Playback",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Notificação que mantém o áudio do GDrums tocando em segundo plano");
        channel.setShowBadge(false);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(channel);
    }
}
