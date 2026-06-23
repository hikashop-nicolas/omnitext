package app.omnitext;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

// WebView whole-page zoom stays off (the default): pinch-to-zoom is handled in the
// editor so only the document zooms, driving its zoom control.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FileOpenerPlugin.class); // must precede super.onCreate
        super.onCreate(savedInstanceState);
        FileOpenerPlugin.handleIntent(this, getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // App brought to front for a new file: stash it; the WebView pulls on resume.
        FileOpenerPlugin.handleIntent(this, intent);
    }
}
