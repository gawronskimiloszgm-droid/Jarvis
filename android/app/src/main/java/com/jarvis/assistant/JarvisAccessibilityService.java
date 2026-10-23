package com.jarvis.assistant;

import android.accessibilityservice.AccessibilityService;
import android.os.Build;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;

// Usluga dostepnosci - pozwala Jarvisowi sterowac WNETRZEM aplikacji
// (cofnij, ekran glowny, przewijanie, klikniecie przycisku po napisie),
// a nie tylko je otwierac.
//
// SWIADOME OGRANICZENIA:
// - Usluga nie reaguje na zdarzenia systemowe i niczego nie zbiera w tle.
//   Dziala wylacznie na zadanie, gdy uzytkownik o cos poprosi.
// - Udostepnia zamknieta liste operacji. Nie ma tu wpisywania dowolnego
//   tekstu ani odczytu zawartosci ekranu do modelu - to celowo osobna
//   funkcja, wymagajaca osobnej zgody.
// - Klikanie odbywa sie po WIDOCZNYM napisie przycisku, wiec zakres jest
//   przewidywalny i mozliwy do zweryfikowania przez uzytkownika.
public class JarvisAccessibilityService extends AccessibilityService {

    private static JarvisAccessibilityService instance = null;

    public static boolean isConnected() {
        return instance != null;
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Celowo puste: nie nasluchujemy i nie analizujemy tego, co dzieje
        // sie na ekranie. Usluga jest wylacznie wykonawcza.
    }

    @Override
    public void onInterrupt() {
        // Brak dzialan przerywalnych.
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        instance = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    // --- Operacje wywolywane z pluginu ---

    public static boolean back() {
        return globalAction(GLOBAL_ACTION_BACK);
    }

    public static boolean home() {
        return globalAction(GLOBAL_ACTION_HOME);
    }

    public static boolean recents() {
        return globalAction(GLOBAL_ACTION_RECENTS);
    }

    public static boolean notifications() {
        return globalAction(GLOBAL_ACTION_NOTIFICATIONS);
    }

    private static boolean globalAction(int action) {
        if (instance == null) return false;
        return instance.performGlobalAction(action);
    }

    public static boolean scroll(boolean forward) {
        if (instance == null) return false;
        AccessibilityNodeInfo root = instance.getRootInActiveWindow();
        if (root == null) return false;
        try {
            AccessibilityNodeInfo scrollable = findScrollable(root);
            if (scrollable == null) return false;
            int action = forward
                ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;
            return scrollable.performAction(action);
        } finally {
            root.recycle();
        }
    }

    private static AccessibilityNodeInfo findScrollable(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isScrollable()) return node;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            AccessibilityNodeInfo found = findScrollable(child);
            if (found != null) return found;
        }
        return null;
    }

    // Klika element o podanym widocznym napisie. Szuka najpierw dokladnego
    // dopasowania, potem czesciowego - bo uzytkownik rzadko dyktuje etykiete
    // co do znaku ("kliknij zaloguj" vs przycisk "Zaloguj sie").
    public static boolean clickByText(String text) {
        if (instance == null || text == null || text.trim().isEmpty()) return false;
        AccessibilityNodeInfo root = instance.getRootInActiveWindow();
        if (root == null) return false;

        try {
            List<AccessibilityNodeInfo> matches = root.findAccessibilityNodeInfosByText(text);
            if (matches != null) {
                for (AccessibilityNodeInfo node : matches) {
                    if (node == null) continue;
                    if (clickNodeOrParent(node)) return true;
                }
            }
            // Zapasowo: przejscie po drzewie i porownanie bez wielkosci liter
            return clickByTextDeep(root, text.trim().toLowerCase());
        } finally {
            root.recycle();
        }
    }

    private static boolean clickByTextDeep(AccessibilityNodeInfo node, String needle) {
        if (node == null) return false;

        CharSequence t = node.getText();
        CharSequence d = node.getContentDescription();
        String haystack = ((t == null ? "" : t) + " " + (d == null ? "" : d)).trim().toLowerCase();
        if (!haystack.isEmpty() && haystack.contains(needle) && clickNodeOrParent(node)) {
            return true;
        }

        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            if (clickByTextDeep(child, needle)) return true;
        }
        return false;
    }

    // Napis czesto siedzi w elemencie, ktory sam nie jest klikalny (np.
    // TextView w przycisku) - dlatego szukamy najblizszego klikalnego
    // rodzica zamiast rezygnowac.
    private static boolean clickNodeOrParent(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo current = node;
        int guard = 0;
        while (current != null && guard++ < 8) {
            if (current.isClickable() && current.isEnabled()) {
                return current.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            }
            current = current.getParent();
        }
        return false;
    }

    public static boolean supportsGestures() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.N;
    }
}
