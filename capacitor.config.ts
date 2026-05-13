import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gdrums.app',
  appName: 'GDrums',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    allowNavigation: ['*']
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystorePassword: undefined,
      keystoreAlias: undefined,
      keystoreAliasPassword: undefined,
      releaseType: 'APK'
    }
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    scheme: 'GDrums',
    // Exclui onesignal-cordova-plugin do build iOS. O plugin faz method
    // swizzling do application:didFinishLaunchingWithOptions: que estava
    // interferindo com WKWebView/AudioContext — sintoma: app não tocava
    // áudio nenhum, ritmos ficavam queued (laranja) mas o som nunca
    // disparava. Issue OneSignal #1104 + #1069 (SPM).
    //
    // Plugin continua ativo no Android (lá usa Java/Kotlin, não tem o bug).
    // Push iOS volta quando tivermos plugin compatível ou implementação
    // própria via @capacitor/push-notifications.
    includePlugins: [
      '@capacitor-community/keep-awake',
      '@capacitor/app',
      '@capacitor/haptics',
      '@capacitor/status-bar',
      '@capgo/native-purchases',
    ],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#030014'
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    }
  }
};

export default config;
