package com.jarvis.assistant;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Most do porannego telefonu: warstwa webowa ustawia godzine i dni, sprawdza uprawnienia
// (powiadomienia, dokladne budziki, pelny ekran) i odbiera informacje, ze telefon zostal odebrany.
@CapacitorPlugin(name = "CallAlarm")
public class CallAlarmPlugin extends Plugin {

    @PluginMethod
    public void configure(PluginCall call) {
        Context c = getContext();
        String time = call.getString("time", "06:00");
        int hour = 6;
        int minute = 0;
        try {
            hour = Integer.parseInt(time.substring(0, 2));
            minute = Integer.parseInt(time.substring(3, 5));
        } catch (Exception ignored) {
            call.reject("Zła godzina");
            return;
        }
        StringBuilder days = new StringBuilder();
        JSArray arr = call.getArray("days", new JSArray());
        for (int i = 0; i < arr.length(); i++) {
            int d = arr.optInt(i, -1);
            if (d >= 0 && d <= 6) days.append(d);
        }
        CallAlarm.prefs(c).edit()
                .putBoolean("enabled", Boolean.TRUE.equals(call.getBoolean("enabled", false)))
                .putInt("hour", Math.max(0, Math.min(23, hour)))
                .putInt("minute", Math.max(0, Math.min(59, minute)))
                .putString("days", days.toString())
                .apply();
        long at = CallAlarm.reschedule(c);
        JSObject ret = status(c);
        ret.put("scheduledAt", at);
        call.resolve(ret);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status(getContext()));
    }

    private JSObject status(Context c) {
        JSObject ret = new JSObject();
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        ret.put("supported", true);
        ret.put("notifications", NotificationManagerCompat.from(c).areNotificationsEnabled());
        ret.put("exactAlarms", Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms());
        ret.put("fullScreen", Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent());
        ret.put("enabled", CallAlarm.prefs(c).getBoolean("enabled", false));
        ret.put("scheduledAt", CallAlarm.prefs(c).getLong("scheduledAt", 0));
        return ret;
    }

    /** Otwiera ekran ustawien dla brakujacego uprawnienia: notifications | exactAlarms | fullScreen. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Context c = getContext();
        String which = call.getString("which", "notifications");
        Intent i;
        if ("exactAlarms".equals(which) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + c.getPackageName()));
        } else if ("fullScreen".equals(which) && Build.VERSION.SDK_INT >= 34) {
            i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + c.getPackageName()));
        } else {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName());
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        c.startActivity(i);
        call.resolve();
    }

    /** Proba: telefon za `seconds` sekund (bez zmiany harmonogramu). */
    @PluginMethod
    public void test(PluginCall call) {
        int seconds = Math.max(3, Math.min(120, call.getInt("seconds", 5)));
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> CallAlarmReceiver.ring(getContext()), seconds * 1000L);
        call.resolve();
    }

    /** Czy aplikacja zostala otwarta przez "Odbierz" (w ciagu ostatnich 3 minut); kasuje znacznik. */
    @PluginMethod
    public void consumeAnswer(PluginCall call) {
        long at = CallAlarm.prefs(getContext()).getLong("answeredAt", 0);
        CallAlarm.prefs(getContext()).edit().remove("answeredAt").apply();
        JSObject ret = new JSObject();
        ret.put("answered", at > 0 && System.currentTimeMillis() - at < 180000);
        call.resolve(ret);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (CallActivity.ACTION_ANSWER.equals(intent.getAction())) notifyListeners("answered", new JSObject(), true);
    }
}
