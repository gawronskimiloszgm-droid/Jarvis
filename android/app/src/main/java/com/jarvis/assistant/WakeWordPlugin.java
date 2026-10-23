package com.jarvis.assistant;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.regex.Pattern;

// Lokalny wykrywacz slowa "Jarvis" dla apki mobilnej. WebView na Androidzie
// (w przeciwienstwie do desktopowego Chrome) nie udostepnia stronom Web
// Speech API, wiec korzystamy wprost z android.speech.SpeechRecognizer -
// tego samego silnika, ktory stoi za dyktowaniem w klawiaturze Google - ten
// jest dostepny natywnym aplikacjom, niezaleznie od WebView.
@CapacitorPlugin(
    name = "WakeWord",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") }
)
public class WakeWordPlugin extends Plugin implements RecognitionListener {

    private static final Pattern WAKE_PATTERN = Pattern.compile("\\b(d?zarwis|jarwis|jarvis)\\b");
    private static final int MAX_QUICK_FAILURES = 5;

    private SpeechRecognizer recognizer;
    private Handler mainHandler;
    private boolean wanted = false;
    private int quickFailureCount = 0;
    private long lastStartAt = 0;

    @Override
    public void load() {
        mainHandler = new Handler(Looper.getMainLooper());
    }

    @PluginMethod
    public void start(PluginCall call) {
        wanted = true;
        quickFailureCount = 0;
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "permissionCallback");
            return;
        }
        call.resolve();
        mainHandler.post(this::beginListening);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            call.resolve();
            mainHandler.post(this::beginListening);
        } else {
            call.reject("microphone permission denied");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        wanted = false;
        mainHandler.post(this::stopListening);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        wanted = false;
        stopListening();
    }

    private void beginListening() {
        if (!wanted || recognizer != null) return;
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) return;

        recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
        recognizer.setRecognitionListener(this);

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pl-PL");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());

        lastStartAt = System.currentTimeMillis();
        recognizer.startListening(intent);
    }

    private void stopListening() {
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
    }

    private void restartSoon() {
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        if (!wanted) return;

        long ranMs = System.currentTimeMillis() - lastStartAt;
        quickFailureCount = ranMs < 2000 ? quickFailureCount + 1 : 0;
        if (quickFailureCount >= MAX_QUICK_FAILURES) {
            wanted = false;
            return;
        }
        mainHandler.postDelayed(this::beginListening, 400);
    }

    private void checkText(String text) {
        if (text == null) return;
        String normalized = Normalizer
            .normalize(text.toLowerCase(), Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "")
            .replace('ł', 'l');
        if (WAKE_PATTERN.matcher(normalized).find()) {
            notifyListeners("wake", new JSObject());
        }
    }

    @Override
    public void onResults(Bundle results) {
        ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches != null) {
            for (String m : matches) checkText(m);
        }
        restartSoon();
    }

    @Override
    public void onPartialResults(Bundle partialResults) {
        ArrayList<String> matches = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (matches != null) {
            for (String m : matches) checkText(m);
        }
    }

    @Override
    public void onError(int error) {
        restartSoon();
    }

    @Override
    public void onReadyForSpeech(Bundle params) {}

    @Override
    public void onBeginningOfSpeech() {}

    @Override
    public void onRmsChanged(float rmsdB) {}

    @Override
    public void onBufferReceived(byte[] buffer) {}

    @Override
    public void onEndOfSpeech() {}

    @Override
    public void onEvent(int eventType, Bundle params) {}
}
