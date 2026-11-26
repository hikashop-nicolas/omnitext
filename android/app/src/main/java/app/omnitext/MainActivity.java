package app.omnitext;

import android.content.Intent;
import android.os.Bundle;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

// WebView whole-page zoom stays off (the default): pinch-to-zoom is handled in the
// editor so only the document zooms, driving its zoom control.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FileOpenerPlugin.class); // must precede super.onCreate
        registerPlugin(PrinterPlugin.class);
        registerPlugin(SystemBarsPlugin.class);
        super.onCreate(savedInstanceState);
        FileOpenerPlugin.handleIntent(this, getIntent());
        // Back steps out inside the app first (fullscreen, a popup, the document); only the start screen exits.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() == null) {
                    exitBack(this);
                    return;
                }
                getBridge().getWebView().evaluateJavascript(
                    "window.omnitextBack ? window.omnitextBack() : false",
                    value -> { if (!"true".equals(value)) exitBack(this); });
            }
        });
    }

    private void exitBack(OnBackPressedCallback cb) {
        cb.setEnabled(false);
        getOnBackPressedDispatcher().onBackPressed();
        cb.setEnabled(true);
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // App brought to front for a new file: stash it; the WebView pulls on resume.
        FileOpenerPlugin.handleIntent(this, intent);
    }
}
