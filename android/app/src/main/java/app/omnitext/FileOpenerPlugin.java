package app.omnitext;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

// Delivers a file opened via Android's "Open with" / share sheet to the web app. The OS hands
// us a content:// URI that the WebView cannot read on its own, so the bytes are COPIED TO A
// CACHE FILE and the web app is handed a URL it can fetch. It pulls that via getPendingFile()
// on startup and on resume; a pull model avoids the timing trap where an onNewIntent fires
// before JS has a listener (e.g. a singleTask relaunch into an existing task).
//
// The copy is streamed, and what crosses the bridge is a URL rather than the content. Sending
// the bytes as base64 (which this used to do) cannot work for the files people actually open
// with a player: the whole video is held in memory, grows by a third in base64, and crosses
// the bridge as a single JSON string. Past a certain size it simply failed, and the app came
// up on an empty document as though nothing had been opened.
@CapacitorPlugin(name = "FileOpener")
public class FileOpenerPlugin extends Plugin {
    /** Where an opened file is staged, under the app cache. */
    private static final String STAGE_DIR = "opened";

    // Set from the launch / new intent (which can fire before JS is ready), consumed on pull.
    private static JSObject pending;

    @PluginMethod
    public void getPendingFile(PluginCall call) {
        JSObject ret = pending != null ? pending : new JSObject();
        pending = null;
        String path = ret.getString("path");
        if (path != null) {
            // A filesystem path means nothing to the WebView; hand it the http URL the bridge
            // serves that file from, which it can fetch and stream like any other resource.
            ret.put("url", getBridge().getLocalUrl() != null
                ? com.getcapacitor.FileUtils.getPortablePath(getContext(), getBridge().getLocalUrl(), Uri.fromFile(new File(path)))
                : Uri.fromFile(new File(path)).toString());
        }
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
        JSObject payload = stage(ctx, uri);
        if (payload != null) pending = payload;
    }

    /**
     * Copy what the intent points at into the app cache and describe it. Returns null when the
     * stream cannot be read; a copy that fails part-way deletes what it wrote rather than
     * leaving a truncated file behind, since half a video is worse than a stated failure.
     */
    private static JSObject stage(Context ctx, Uri uri) {
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

        File dir = new File(ctx.getCacheDir(), STAGE_DIR);
        clear(dir); // only the newest opened file is ever wanted
        if (!dir.exists() && !dir.mkdirs()) return null;
        // Keep the display name, since its extension is how the app picks an editor, but do
        // not let it climb out of the staging directory.
        File out = new File(dir, name.replaceAll("[/\\\\]", "_"));
        long copied = 0;
        try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) return null;
            byte[] buf = new byte[64 * 1024];
            int r;
            while ((r = in.read(buf)) != -1) {
                os.write(buf, 0, r);
                copied += r;
            }
            os.flush();
        } catch (Exception e) {
            out.delete();
            return null;
        }
        JSObject o = new JSObject();
        o.put("name", name);
        o.put("mime", mime == null ? "" : mime);
        o.put("path", out.getAbsolutePath());
        o.put("size", copied);
        return o;
    }

    private static void clear(File dir) {
        File[] old = dir.listFiles();
        if (old == null) return;
        for (File f : old) f.delete();
    }
}
