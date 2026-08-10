package com.jarvis.assistant;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;

// Usluga pierwszoplanowa utrzymujaca Jarvisa "przy zyciu" po zamknieciu
// aplikacji, wraz z pluwajacym dymkiem (jak glowy czatu w Messengerze).
//
// Dlaczego uslugа pierwszoplanowa, a nie zwykla: Android agresywnie ubija
// zwykle uslugi w tle. Tylko usluga pierwszoplanowa - z widocznym,
// nieusuwalnym powiadomieniem - ma szanse dzialac dlugo. To swiadomy
// kompromis: powiadomienie jest cena za to, ze Jarvis nie znika.
public class JarvisBubbleService extends Service {

    public static final String ACTION_STOP = "com.jarvis.assistant.STOP_BUBBLE";
    private static final String CHANNEL_ID = "jarvis_bubble";
    private static final int NOTIFICATION_ID = 4711;

    private static boolean running = false;

    private WindowManager windowManager;
    private View bubbleView;
    private WindowManager.LayoutParams params;

    public static boolean isRunning() {
        return running;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        startForegroundWithNotification();
        addBubble();
        running = true;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        // START_STICKY: gdy system ubije usluge z braku pamieci, wroci sama.
        return START_STICKY;
    }

    private void startForegroundWithNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "J.A.R.V.I.S.",
                NotificationManager.IMPORTANCE_LOW // LOW = bez dzwieku i wibracji
            );
            channel.setDescription("Jarvis dziala w tle");
            channel.setShowBadge(false);
            nm.createNotificationChannel(channel);
        }

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent openPending = PendingIntent.getActivity(this, 0, openIntent, flags);

        Intent stopIntent = new Intent(this, JarvisBubbleService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 1, stopIntent, flags);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        Notification notification = b
            .setContentTitle("J.A.R.V.I.S.")
            .setContentText("Na stanowisku, sir.")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(openPending)
            .addAction(0, "Zakoncz", stopPending)
            .setOngoing(true)
            .build();

        // Android 14 wymaga podania typu uslugi pierwszoplanowej.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void addBubble() {
        windowManager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        bubbleView = LayoutInflater.from(this).inflate(R.layout.jarvis_bubble, null);

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;

        params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = 0;
        params.y = 220;

        bubbleView.setOnTouchListener(new BubbleTouchListener());

        try {
            windowManager.addView(bubbleView, params);
        } catch (Exception e) {
            // Brak zgody na nakladke - usluga i tak zostaje, dymka nie ma.
            bubbleView = null;
        }
    }

    // Rozroznia dotkniecie (otworz aplikacje) od przeciagniecia (przesun
    // dymek). Bez tego kazde przesuniecie konczyloby sie otwarciem apki.
    private class BubbleTouchListener implements View.OnTouchListener {
        private int initialX, initialY;
        private float touchX, touchY;
        private long downAt;
        private final int slop = ViewConfiguration.get(JarvisBubbleService.this).getScaledTouchSlop();

        @Override
        public boolean onTouch(View v, MotionEvent event) {
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    initialX = params.x;
                    initialY = params.y;
                    touchX = event.getRawX();
                    touchY = event.getRawY();
                    downAt = System.currentTimeMillis();
                    return true;

                case MotionEvent.ACTION_MOVE:
                    params.x = initialX + (int) (event.getRawX() - touchX);
                    params.y = initialY + (int) (event.getRawY() - touchY);
                    try {
                        windowManager.updateViewLayout(bubbleView, params);
                    } catch (Exception ignored) {
                    }
                    return true;

                case MotionEvent.ACTION_UP: {
                    float dx = Math.abs(event.getRawX() - touchX);
                    float dy = Math.abs(event.getRawY() - touchY);
                    boolean isTap = dx < slop && dy < slop
                        && System.currentTimeMillis() - downAt < 400;
                    if (isTap) {
                        openApp();
                    } else {
                        snapToEdge();
                    }
                    return true;
                }
                default:
                    return false;
            }
        }
    }

    // Po przeciagnieciu dymek przykleja sie do blizszej krawedzi ekranu,
    // zeby nie zaslanial srodka.
    private void snapToEdge() {
        if (bubbleView == null) return;
        Configuration cfg = getResources().getConfiguration();
        int screenWidth = (int) (cfg.screenWidthDp * getResources().getDisplayMetrics().density);
        int bubbleWidth = bubbleView.getWidth();
        params.x = (params.x + bubbleWidth / 2) < screenWidth / 2 ? 0 : screenWidth - bubbleWidth;
        try {
            windowManager.updateViewLayout(bubbleView, params);
        } catch (Exception ignored) {
        }
    }

    private void openApp() {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        // Sygnal dla warstwy webowej, ze uzytkownik wszedl przez dymek -
        // wtedy od razu startuje rozmowa, zamiast czekac na kolejny gest.
        i.putExtra("fromBubble", true);
        startActivity(i);
    }

    @Override
    public void onDestroy() {
        running = false;
        if (bubbleView != null && windowManager != null) {
            try {
                windowManager.removeView(bubbleView);
            } catch (Exception ignored) {
            }
            bubbleView = null;
        }
        super.onDestroy();
    }
}
