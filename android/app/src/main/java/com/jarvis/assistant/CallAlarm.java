package com.jarvis.assistant;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

import java.util.Calendar;

// Poranny telefon od Jarvisa: harmonogram (godzina + dni tygodnia) trzymany w telefonie, zeby
// dzwonil takze bez internetu i po restarcie. Budzik systemowy (setAlarmClock) uruchamia
// CallAlarmReceiver, a ten pokazuje pelnoekranowe polaczenie przychodzace (CallActivity).
final class CallAlarm {
    static final String PREFS = "jarvis_call";
    static final String CHANNEL = "jarvis_call";
    static final int NOTIFY_ID = 4706;

    private CallAlarm() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Najblizszy termin po teraz: dni jak w Calendar (1=niedziela..7=sobota) zapisane jako 0..6. */
    static long nextAt(Context c, long now) {
        SharedPreferences p = prefs(c);
        if (!p.getBoolean("enabled", false)) return 0;
        int hour = p.getInt("hour", 6);
        int minute = p.getInt("minute", 0);
        String days = p.getString("days", "12345");
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(now);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        cal.set(Calendar.HOUR_OF_DAY, hour);
        cal.set(Calendar.MINUTE, minute);
        for (int i = 0; i < 8; i++) {
            int dow = cal.get(Calendar.DAY_OF_WEEK) - 1;
            if (cal.getTimeInMillis() > now && days.indexOf(Character.forDigit(dow, 10)) >= 0) return cal.getTimeInMillis();
            cal.add(Calendar.DAY_OF_MONTH, 1);
        }
        return 0;
    }

    private static PendingIntent firePending(Context c) {
        Intent i = new Intent(c, CallAlarmReceiver.class).setAction(CallAlarmReceiver.ACTION_RING);
        return PendingIntent.getBroadcast(c, 1, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Ustawia (albo kasuje) budzik na najblizszy termin. Zwraca ten termin albo 0. */
    static long reschedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = firePending(c);
        am.cancel(pi);
        long at = nextAt(c, System.currentTimeMillis());
        prefs(c).edit().putLong("scheduledAt", at).apply();
        if (at == 0) return 0;
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent show = PendingIntent.getActivity(c, 2, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        // setAlarmClock: dokladnie o czasie takze w trybie oszczedzania energii (Doze), ikona budzika na pasku.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } else {
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), pi);
        }
        return at;
    }

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Poranny telefon od Jarvisa", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Połączenie przychodzące z raportem porannym");
        ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] { 0, 1000, 600, 1000, 600, 1000 });
        ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }
}
