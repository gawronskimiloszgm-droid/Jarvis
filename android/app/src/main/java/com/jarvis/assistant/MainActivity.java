package com.jarvis.assistant;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DeviceControlPlugin.class);
        registerPlugin(WakeWordPlugin.class);
        registerPlugin(BubblePlugin.class);
        registerPlugin(AppControlPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
