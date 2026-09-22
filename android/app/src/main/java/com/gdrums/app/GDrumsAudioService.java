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
 *
 * ═══════════════════════════════════════════════════════════════════════
 * O CONTRATO VEM PRIMEIRO. NÃO COLOQUE NADA ANTES DO startForeground().
 * ═══════════════════════════════════════════════════════════════════════
 * Quem chama startForegroundService() tem uma janela curta pra chamar
 * startForeground(). Estourou, o Android MATA o app com
 * RemoteServiceException$ForegroundServiceDidNotStartInTimeException.
 *
 * Isso foi 93% de todas as falhas do app no Play (versões 1.4.1 e 1.4.2),
 * com a taxa em 1,24% contra o limite de 1,09% que o Google usa pra
 * limitar descoberta na loja. Vitima tipica: Xiaomi/MIUI, que é lenta pra
 * entregar callback de serviço e agressiva pra matar processo.
 *
 * A causa era a ORDEM: o código montava PendingIntent, MediaSession e
 * MediaStyle ANTES de chamar startForeground, tudo na thread principal.
 * Medido em emulador rápido e ocioso: 59 a 96 ms. Em aparelho de entrada
 * carregado, isso vira segundos, e aí o relógio do Android estoura.
 *
 * Efeito colateral do mesmo defeito: enquanto o onStartCommand não
 * termina, a thread principal fica presa. Medi 8,93 s de bloqueio com o
 * serviço lento. É a explicação dos ANRs de "Input dispatching timed out"
 * e dos frames lentos.
 *
 * Agora a ordem é: canal → notificação mínima → startForeground → e só
 * então MediaSession e notificação completa. O trabalho pesado acontece
 * com o app já em foreground, sem relógio correndo.
 */
public class GDrumsAudioService extends Service {
    private static final String CHANNEL_ID = "gdrums_playback";
    private static final int NOTIFICATION_ID = 1042;

    /**
     * Comando de parada. O plugin manda ISTO em vez de chamar stopService().
     *
     * Por quê: stopService() pode chegar ANTES do serviço nascer. Nesse caso
     * o serviço é descartado sem nunca chamar startForeground(), o contrato
     * aberto pelo startForegroundService() fica pendente, e o Android mata o
     * app. Reproduzi exatamente assim, com 50 ms entre ligar e desligar:
     *
     *   FATAL EXCEPTION: main
     *   RemoteServiceException$ForegroundServiceDidNotStartInTimeException
     *
     * Com um comando, o caminho é sempre o mesmo: o serviço nasce, cumpre o
     * contrato no onCreate, e só então se desliga sozinho. Não existe mais
     * janela em que um start fique sem o seu startForeground.
     */
    static final String ACAO_PARAR = "com.gdrums.app.PARAR_AUDIO";

    private MediaSessionCompat mediaSession;
    /** Última notificação montada, reaproveitada em chamadas repetidas. */
    private Notification notificacaoAtual;
    private boolean emForeground = false;

    @Override
    public void onCreate() {
        super.onCreate();
        criarCanal();

        // 1. CONTRATO. Notificação mínima: sem PendingIntent, sem
        //    MediaStyle, sem MediaSession. Só o que o Android exige.
        entrarEmForeground(notificacaoMinima());


        // 2. Agora o resto, sem relógio correndo. Se falhar, o app já está
        //    em foreground e não morre por causa disso.
        try {
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

            // Sobe pra notificação completa (lockscreen, Bluetooth do carro).
            // Mesmo ID = atualiza a que já está na barra, sem piscar.
            notificacaoAtual = notificacaoCompleta();
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.notify(NOTIFICATION_ID, notificacaoAtual);
        } catch (Exception e) {
            // Sem MediaSession o áudio continua tocando; só perde o
            // controle no lockscreen. Não é motivo pra derrubar o show.
            android.util.Log.w("GDrumsAudioService", "MediaSession falhou: " + e.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // SEMPRE cumpre o contrato ANTES de qualquer decisão. Cada
        // startForegroundService() abre um contrato, inclusive quando o
        // serviço já está de pé e inclusive quando o comando é pra PARAR.
        // Usa a notificação em cache: custo perto de zero.
        entrarEmForeground(notificacaoAtual != null ? notificacaoAtual : notificacaoMinima());

        // Pedido de parada. Chega por aqui, e não por stopService(), de
        // propósito: ver o comentário do ACAO_PARAR.
        if (intent != null && ACAO_PARAR.equals(intent.getAction())) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        // START_NOT_STICKY, não START_STICKY.
        //
        // Quem produz o som é o Web Audio dentro da WebView. Se o processo
        // morreu, não há o que tocar: recriar o serviço sozinho só faz o
        // Android abrir OUTRO contrato de startForeground, agora em
        // processo FRIO, que é justamente o cenário mais lento e o que
        // mais derruba o app na MIUI. Sem áudio pra manter, o serviço
        // ressuscitado não serve pra nada e só cria risco.
        return START_NOT_STICKY;
    }

    /** startForeground com o tipo exigido no Android 14+, à prova de falha. */
    private void entrarEmForeground(Notification n) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ServiceCompat.startForeground(
                    this, NOTIFICATION_ID, n,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                );
            } else {
                startForeground(NOTIFICATION_ID, n);
            }
            emForeground = true;
        } catch (Exception e) {
            // Android 12+ recusa iniciar serviço em foreground vindo do
            // background. Sem o try/catch isso vira crash. Desistir em
            // silêncio é melhor: o app segue tocando com a tela ligada.
            android.util.Log.w("GDrumsAudioService", "startForeground recusado: " + e.getMessage());
            emForeground = false;
            stopSelf();
        }
    }

    /** Barata de propósito: é ela que cumpre o prazo do Android. */
    private Notification notificacaoMinima() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("GDrums")
            .setContentText("Tocando ritmo")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    /** Com toque no app, MediaStyle e lockscreen. Montada FORA do prazo. */
    private Notification notificacaoCompleta() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("GDrums")
            .setContentText("Tocando ritmo")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setStyle(new MediaStyle().setMediaSession(mediaSession.getSessionToken()))
            .setOngoing(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    @Override
    public void onDestroy() {
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        emForeground = false;
        notificacaoAtual = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void criarCanal() {
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
