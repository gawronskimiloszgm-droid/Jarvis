package com.jarvis.assistant;

import android.app.Activity;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

// Ekran polaczenia przychodzacego od Jarvisa (takze na zablokowanym telefonie). Dzwonek gra kanal
// powiadomienia; tu tylko decyzja: Odbierz otwiera aplikacje z rozmowa i raportem porannym,
// Odrzuc konczy. Bez reakcji ekran sam znika po 90 s (razem z powiadomieniem).
public class CallActivity extends Activity {
    static final String ACTION_ANSWER = "com.jarvis.assistant.CALL_ANSWER";
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (ACTION_ANSWER.equals(getIntent().getAction())) {
            answer();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.rgb(3, 9, 20));
        int pad = dp(28);
        root.setPadding(pad, pad, pad, pad);

        TextView ring = new TextView(this);
        ring.setText("◎");
        ring.setTextColor(Color.rgb(51, 224, 255));
        ring.setTextSize(96);
        ring.setGravity(Gravity.CENTER);
        TextView title = text("J.A.R.V.I.S.", 34, Color.rgb(232, 246, 255), true);
        TextView sub = text("dzwoni · raport poranny", 18, Color.rgb(159, 216, 255), false);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.CENTER);
        buttons.setPadding(0, dp(60), 0, 0);
        Button decline = round("Odrzuć", Color.rgb(220, 53, 69));
        Button accept = round("Odbierz", Color.rgb(40, 180, 99));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(120), dp(120));
        lp.setMargins(dp(24), 0, dp(24), 0);
        buttons.addView(decline, lp);
        buttons.addView(accept, lp);
        decline.setOnClickListener(v -> finishCall());
        accept.setOnClickListener(v -> answer());

        root.addView(ring);
        root.addView(title);
        root.addView(sub);
        root.addView(buttons);
        setContentView(root);
        handler.postDelayed(this::finishCall, 90000);
    }

    private void answer() {
        CallAlarm.prefs(this).edit().putLong("answeredAt", System.currentTimeMillis()).apply();
        cancelNotification();
        // Na zablokowanym telefonie najpierw odblokowanie (rozmowa i dane sa w aplikacji).
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && km != null && km.isKeyguardLocked()) {
            km.requestDismissKeyguard(this, null);
        }
        Intent open = new Intent(this, MainActivity.class).setAction(ACTION_ANSWER).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(open);
        finish();
    }

    private void finishCall() {
        cancelNotification();
        finish();
    }

    private void cancelNotification() {
        handler.removeCallbacksAndMessages(null);
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).cancel(CallAlarm.NOTIFY_ID);
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        return t;
    }

    private Button round(String label, int color) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextColor(Color.WHITE);
        b.setAllCaps(false);
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        g.setColor(color);
        b.setBackground(g);
        return b;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
