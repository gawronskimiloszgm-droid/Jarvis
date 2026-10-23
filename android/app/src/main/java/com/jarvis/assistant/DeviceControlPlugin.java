package com.jarvis.assistant;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.net.Uri;
import android.view.KeyEvent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Mobilny odpowiednik desktop/actions.js - taka sama zasada: staly bialy
// wykaz nazw akcji, bez dowolnego tekstu od AI trafiajacego do systemu.
@CapacitorPlugin(name = "DeviceControl")
public class DeviceControlPlugin extends Plugin {

    // AC/DC - "Back in Black". Identyfikator sprawdzony, nie zgadywany.
    private static final String WAKE_TRACK_ID = "08mG3Y1vljYA6bvDt4Wqkj";

    @PluginMethod
    public void runAction(PluginCall call) {
        String name = call.getString("name", "");
        Context ctx = getContext();
        boolean ok;

        switch (name) {
            case "otworz-spotify":
                ok = openApp("com.spotify.music", "https://open.spotify.com");
                break;
            case "pobudka":
                // AC/DC - "Back in Black". Schemat spotify: otwiera aplikacje
                // i od razu odtwarza; bez niej ladujemy w przegladarce.
                ok = openUrl("spotify:track:" + WAKE_TRACK_ID);
                if (!ok) ok = openUrl("https://open.spotify.com/track/" + WAKE_TRACK_ID);
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
            case "odtworz-pauza":
                ok = mediaKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);
                break;
            case "nastepny-utwor":
                ok = mediaKey(KeyEvent.KEYCODE_MEDIA_NEXT);
                break;
            case "poprzedni-utwor":
                ok = mediaKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS);
                break;
            default:
                ok = false;
        }

        JSObject ret = new JSObject();
        ret.put("ok", ok);
        call.resolve(ret);
    }

    // Klawisz medialny trafia do aplikacji, ktora aktualnie odtwarza dzwiek -
    // dziala tak samo ze Spotify, YouTube Music czy czymkolwiek innym.
    private boolean mediaKey(int keyCode) {
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return false;
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, keyCode));
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, keyCode));
        return true;
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
