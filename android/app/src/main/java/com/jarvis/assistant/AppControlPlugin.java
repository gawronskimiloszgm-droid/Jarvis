package com.jarvis.assistant;

import android.content.Intent;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Most do uslugi dostepnosci. Przyjmuje WYLACZNIE nazwy z zamknietej listy
// ponizej - dowolny tekst od modelu nie ma jak zamienic sie w nieoczekiwana
// operacje na telefonie. Wyjatkiem jest parametr "tekst" przy klikaniu,
// ale i on sluzy tylko do odnalezienia przycisku o takim napisie.
@CapacitorPlugin(name = "AppControl")
public class AppControlPlugin extends Plugin {

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", JarvisAccessibilityService.isConnected());
        call.resolve(ret);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void run(PluginCall call) {
        String action = call.getString("action", "");
        String text = call.getString("text", "");

        if (!JarvisAccessibilityService.isConnected()) {
            call.reject("Usluga dostepnosci Jarvisa nie jest wlaczona.");
            return;
        }

        boolean ok;
        switch (action) {
            case "wstecz":
                ok = JarvisAccessibilityService.back();
                break;
            case "ekran-glowny":
                ok = JarvisAccessibilityService.home();
                break;
            case "ostatnie-aplikacje":
                ok = JarvisAccessibilityService.recents();
                break;
            case "powiadomienia":
                ok = JarvisAccessibilityService.notifications();
                break;
            case "przewin-w-dol":
                ok = JarvisAccessibilityService.scroll(true);
                break;
            case "przewin-w-gore":
                ok = JarvisAccessibilityService.scroll(false);
                break;
            case "kliknij":
                ok = JarvisAccessibilityService.clickByText(text);
                break;
            default:
                call.reject("Nieznana akcja: " + action);
                return;
        }

        JSObject ret = new JSObject();
        ret.put("ok", ok);
        call.resolve(ret);
    }
}
