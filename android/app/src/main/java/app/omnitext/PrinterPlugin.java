package app.omnitext;

import android.content.Context;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.webkit.WebView;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

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

    // Print a file that is already a printable document, streamed to the printer as it is.
    // A PDF goes this way rather than through the WebView: on screen its pages are canvases
    // about 96 dpi wide, and printing those prints pictures of pages the file describes
    // exactly. The bytes are staged in the app cache first, because sending a document of
    // any size across the bridge as base64 is what this avoids.
    @PluginMethod
    public void printFile(PluginCall call) {
        final String path = call.getString("path");
        final String name = call.getString("name", "document");
        if (path == null) {
            call.reject("no path");
            return;
        }
        final File file = new File(path);
        if (!file.canRead()) {
            call.reject("cannot read " + path);
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager manager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                if (manager == null) {
                    call.reject("no print service");
                    return;
                }
                manager.print(name, new FileAdapter(file, name), new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception e) {
                call.reject("print failed: " + e.getMessage(), e);
            }
        });
    }

    /** Hands an already-paginated document (a PDF) to the printer unchanged. */
    private static class FileAdapter extends PrintDocumentAdapter {
        private final File file;
        private final String name;

        FileAdapter(File file, String name) {
            this.file = file;
            this.name = name;
        }

        @Override
        public void onLayout(PrintAttributes oldAttrs, PrintAttributes newAttrs,
                             CancellationSignal cancel, LayoutResultCallback callback, Bundle extras) {
            if (cancel != null && cancel.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder(name)
                    .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                    .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
                    .build();
            // Always changed: the document does not re-flow for paper size, so there is
            // nothing to recompute and saying "unchanged" can leave the preview empty.
            callback.onLayoutFinished(info, true);
        }

        @Override
        public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                            CancellationSignal cancel, WriteResultCallback callback) {
            try (InputStream in = new FileInputStream(file);
                 OutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                byte[] buf = new byte[16 * 1024];
                int read;
                while ((read = in.read(buf)) > 0) {
                    if (cancel != null && cancel.isCanceled()) {
                        callback.onWriteCancelled();
                        return;
                    }
                    out.write(buf, 0, read);
                }
                out.flush();
                callback.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
            } catch (Exception e) {
                callback.onWriteFailed(e.getMessage());
            }
        }
    }

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
