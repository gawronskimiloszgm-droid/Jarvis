package com.jarvis.assistant;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;

// Budzik porannego telefonu: pokazuje polaczenie przychodzace (pelny ekran nawet na blokadzie)
// i od razu ustawia kolejny termin. Restart telefonu obsluguje CallBootReceiver.
public class CallAlarmReceiver extends BroadcastReceiver {
    static final String ACTION_RING = "com.jarvis.assistant.CALL_RING";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_RING.equals(intent.getAction())) return;
        ring(context);
        CallAlarm.reschedule(context);
    }

    static void ring(Context context) {
        CallAlarm.ensureChannel(context);
        Intent screen = new Intent(context, CallActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        PendingIntent full = PendingIntent.getActivity(context, 3, screen, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent answer = new Intent(context, CallActivity.class).setAction(CallActivity.ACTION_ANSWER).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent answerPi = PendingIntent.getActivity(context, 4, answer, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(context, CallAlarm.CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("J.A.R.V.I.S. dzwoni")
                .setContentText("Raport poranny")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(true)
                .setAutoCancel(true)
                .setTimeoutAfter(90000)
                .setFullScreenIntent(full, true)
                .setContentIntent(full)
                .addAction(0, "Odbierz", answerPi)
                .build();
        n.flags |= Notification.FLAG_INSISTENT; // dzwonek powtarza sie, dopoki ktos nie zareaguje
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).notify(CallAlarm.NOTIFY_ID, n);
    }
}
