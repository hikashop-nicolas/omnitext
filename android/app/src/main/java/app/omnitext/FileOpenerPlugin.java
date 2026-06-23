package app.omnitext;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

// Delivers a file opened via Android's "Open with" / share sheet to the web app. The OS
// hands us a content:// URI that the WebView cannot read on its own, so we read the bytes
// natively and stash them; the web app pulls them via getPendingFile() on startup and on
// resume. A pull model avoids the timing trap where an onNewIntent fires before JS has a
// listener (e.g. a singleTask relaunch into an existing task).
@CapacitorPlugin(name = "FileOpener")
public class FileOpenerPlugin extends Plugin {
    // Set from the launch / new intent (which can fire before JS is ready), consumed on pull.
    private static JSObject pending;

    @PluginMethod
    public void getPendingFile(PluginCall call) {
        JSObject ret = pending != null ? pending : new JSObject();
        pending = null;
        call.resolve(ret);
    }

    // Called by MainActivity for the launch intent and for every onNewIntent.
    static void handleIntent(Context ctx, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri == null) return;
        JSObject payload = read(ctx, uri);
        if (payload != null) pending = payload;
    }

    private static JSObject read(Context ctx, Uri uri) {
        ContentResolver cr = ctx.getContentResolver();
        String name = "file";
        String mime = cr.getType(uri);
        try (Cursor c = cr.query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) {
                    String n = c.getString(i);
                    if (n != null) name = n;
                }
            }
        } catch (Exception ignored) {
        }
        try (InputStream in = cr.openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int r;
            while ((r = in.read(buf)) != -1) out.write(buf, 0, r);
            JSObject o = new JSObject();
            o.put("name", name);
            o.put("mime", mime == null ? "" : mime);
            o.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            return o;
        } catch (Exception e) {
            return null;
        }
    }
}
