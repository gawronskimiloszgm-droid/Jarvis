package com.jarvis.assistant;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Mobilny odpowiednik desktop/actions.js - taka sama zasada: staly bialy
// wykaz nazw akcji, bez dowolnego tekstu od AI trafiajacego do systemu.
@CapacitorPlugin(name = "DeviceControl")
public class DeviceControlPlugin extends Plugin {

    @PluginMethod
    public void runAction(PluginCall call) {
        String name = call.getString("name", "");
        Context ctx = getContext();
        boolean ok;

        switch (name) {
            case "otworz-spotify":
                ok = openApp("com.spotify.music", "https://open.spotify.com");
                break;
            case "otworz-youtube-music":
                ok = openApp("com.google.android.apps.youtube.music", "https://music.youtube.com");
                break;
            case "otworz-przegladarke":
                ok = openUrl("https://www.google.com");
                break;
            case "glosniej":
                ok = adjustVolume(AudioManager.ADJUST_RAISE);
                break;
            case "ciszej":
                ok = adjustVolume(AudioManager.ADJUST_LOWER);
                break;
            case "wycisz":
                ok = adjustVolume(AudioManager.ADJUST_MUTE);
                break;
            default:
                ok = false;
        }

        JSObject ret = new JSObject();
        ret.put("ok", ok);
        call.resolve(ret);
    }

    private boolean adjustVolume(int direction) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return false;
        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI);
        return true;
    }

    private boolean openApp(String packageName, String fallbackUrl) {
        Context ctx = getContext();
        PackageManager pm = ctx.getPackageManager();
        Intent launchIntent = pm.getLaunchIntentForPackage(packageName);
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(launchIntent);
            return true;
        }
        return openUrl(fallbackUrl);
    }

    private boolean openUrl(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
