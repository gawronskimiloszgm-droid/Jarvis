package com.jarvis.assistant;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// Po restarcie telefonu, aktualizacji aplikacji albo zmianie czasu budziki systemowe znikaja albo
// sie przesuwaja: odtwarzamy harmonogram porannego telefonu. Osobno od CallAlarmReceiver, bo ten
// musi byc widoczny dla systemu (exported), a dzwonienie nie moze dac sie wywolac z zewnatrz.
public class CallBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a) || Intent.ACTION_TIME_CHANGED.equals(a) || Intent.ACTION_TIMEZONE_CHANGED.equals(a)) {
            CallAlarm.reschedule(context);
        }
    }
}
