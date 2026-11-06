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
        // Back leaves a fullscreen page before it leaves the app.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (SystemBarsPlugin.immersive && getBridge() != null) {
                    getBridge().getWebView().evaluateJavascript("document.fullscreenElement&&document.exitFullscreen()", null);
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // App brought to front for a new file: stash it; the WebView pulls on resume.
        FileOpenerPlugin.handleIntent(this, intent);
    }
}
