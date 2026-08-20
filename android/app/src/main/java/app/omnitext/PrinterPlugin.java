package app.omnitext;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Printing for the Android app. window.print() does nothing in a WebView: it is implemented by
// Chrome the browser, not by the WebView, so the app's Ctrl+P and its palette entry were inert
// while the same code printed fine on the web.
//
// This hands the WebView's own rendering to Android's PrintManager. That matters more than it
// sounds: the adapter prints what the WebView lays out, so the app's @media print stylesheet
// applies unchanged and there is one description of what a printed page looks like rather than
// two that drift apart.
@CapacitorPlugin(name = "Printer")
public class PrinterPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        final String name = call.getString("name", "document");
        // The adapter must be created on the thread that owns the WebView, and PrintManager
        // wants the UI thread anyway.
        getActivity().runOnUiThread(() -> {
            try {
                WebView web = getBridge().getWebView();
                PrintManager manager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                if (manager == null) {
                    call.reject("no print service");
                    return;
                }
                PrintDocumentAdapter adapter = web.createPrintDocumentAdapter(name);
                manager.print(name, adapter, new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception e) {
                call.reject("print failed: " + e.getMessage(), e);
            }
        });
    }
}
