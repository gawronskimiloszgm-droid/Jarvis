package com.jarvis.assistant;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Most miedzy warstwa webowa a usluga dymka.
//
// Nakladka na inne aplikacje (SYSTEM_ALERT_WINDOW) to uprawnienie
// "specjalne" - nie da sie go przyznac zwyklym okienkiem z prosba.
// Uzytkownik musi je wlaczyc recznie w ustawieniach systemu, dlatego
// wystawiamy osobna metode otwierajaca odpowiedni ekran.
@CapacitorPlugin(name = "Bubble")
public class BubblePlugin extends Plugin {

    private boolean canDrawOverlay() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return Settings.canDrawOverlays(getContext());
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", true);
        ret.put("hasPermission", canDrawOverlay());
        ret.put("running", JarvisBubbleService.isRunning());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (canDrawOverlay()) {
            JSObject ret = new JSObject();
            ret.put("hasPermission", true);
            call.resolve(ret);
            return;
        }
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + getContext().getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        // Zgoda przyznawana jest poza aplikacja - stan sprawdzi ponowne
        // wywolanie status() po powrocie uzytkownika.
        JSObject ret = new JSObject();
        ret.put("hasPermission", false);
        ret.put("opened", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!canDrawOverlay()) {
            call.reject("Brak zgody na nakladke nad innymi aplikacjami.");
            return;
        }
        Context ctx = getContext();
        Intent intent = new Intent(ctx, JarvisBubbleService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent);
        } else {
            ctx.startService(intent);
        }
        JSObject ret = new JSObject();
        ret.put("running", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        ctx.stopService(new Intent(ctx, JarvisBubbleService.class));
        JSObject ret = new JSObject();
        ret.put("running", false);
        call.resolve(ret);
    }

    // Aktywnosc dziala w trybie singleTask, wiec przy kolejnym dotknieciu
    // dymka system nie tworzy jej od nowa, tylko dostarcza nowa intencje.
    private boolean pendingFromBubble = false;

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent != null && intent.getBooleanExtra("fromBubble", false)) {
            pendingFromBubble = true;
        }
    }

    // Zwraca (i kasuje) informacje, czy aplikacje otwarto dotknieciem dymka.
    // Warstwa webowa startuje wtedy rozmowe od razu, zamiast czekac na
    // kolejny gest uzytkownika.
    @PluginMethod
    public void consumeLaunchFlag(PluginCall call) {
        boolean fromBubble = pendingFromBubble;
        pendingFromBubble = false;

        Intent intent = getActivity() != null ? getActivity().getIntent() : null;
        if (intent != null && intent.getBooleanExtra("fromBubble", false)) {
            fromBubble = true;
            intent.removeExtra("fromBubble"); // zeby nie zadzialalo drugi raz
        }

        JSObject ret = new JSObject();
        ret.put("fromBubble", fromBubble);
        call.resolve(ret);
    }
}
