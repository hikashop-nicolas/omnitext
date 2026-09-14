package app.omnitext;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

// Delivers files to the web app. The OS hands us content:// URIs the WebView cannot read on its
// own, so the bytes are COPIED TO A CACHE FILE and the web app is handed a URL it can fetch.
//
// Two ways in. "Open with" / share: the intent arrives with a temporary grant, stashed and
// pulled via getPendingFile() on startup and on resume (a pull model avoids the timing trap
// where an onNewIntent fires before JS has a listener). The in-app Open button: the system
// document picker, whose grant can be made permanent, so the same document can be written back
// on Save and reopened later from the recent files list.
//
// The copy is streamed, and what crosses the bridge is a URL rather than the content: sending
// bytes as base64 cannot carry the files people open with a player.
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
        call.resolve(withUrl(ret));
    }

    /** Open the system document picker; resolves with the staged file, or {} when cancelled. */
    @PluginMethod
    public void pickDocument(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject()); // cancelled
            return;
        }
        Uri uri = data.getData();
        ContentResolver cr = getContext().getContentResolver();
        // Keep the grant past this session. Some providers only allow reading: then the file is
        // still remembered, and Save falls back to the share sheet.
        boolean writable = true;
        try {
            cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (SecurityException e) {
            writable = false;
            try {
                cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException ignored) {
                // Readable for now only; reopening later will report it gone.
            }
        }
        resolveStaged(call, uri, writable);
    }

    /** Reopen a document picked earlier; rejects with "gone" when its permission was lost. */
    @PluginMethod
    public void reopenDocument(PluginCall call) {
        String s = call.getString("uri");
        if (s == null) {
            call.reject("missing uri");
            return;
        }
        Uri uri = Uri.parse(s);
        UriPermission perm = persisted(uri);
        if (perm == null || !perm.isReadPermission()) {
            call.reject("gone", "gone");
            return;
        }
        resolveStaged(call, uri, perm.isWritePermission());
    }

    /** Overwrite a picked document with a file already written to the app cache. */
    @PluginMethod
    public void writeDocument(PluginCall call) {
        String s = call.getString("uri");
        String path = call.getString("path");
        if (s == null || path == null) {
            call.reject("missing uri or path");
            return;
        }
        Uri uri = Uri.parse(s);
        // "wt" truncates: a shorter document must not keep the tail of the longer one it replaces.
        try (InputStream in = new FileInputStream(path);
             OutputStream os = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (os == null) {
                call.reject("not writable");
                return;
            }
            byte[] buf = new byte[64 * 1024];
            int r;
            while ((r = in.read(buf)) != -1) os.write(buf, 0, r);
            os.flush();
        } catch (Exception e) {
            call.reject("write failed", e);
            return;
        } finally {
            new File(path).delete();
        }
        call.resolve();
    }

    /** Give back the lasting permission of a document removed from the recent list. */
    @PluginMethod
    public void forgetDocument(PluginCall call) {
        String s = call.getString("uri");
        if (s != null) {
            Uri uri = Uri.parse(s);
            UriPermission perm = persisted(uri);
            if (perm != null) {
                int flags = (perm.isReadPermission() ? Intent.FLAG_GRANT_READ_URI_PERMISSION : 0)
                    | (perm.isWritePermission() ? Intent.FLAG_GRANT_WRITE_URI_PERMISSION : 0);
                try {
                    getContext().getContentResolver().releasePersistableUriPermission(uri, flags);
                } catch (SecurityException ignored) {
                }
            }
        }
        call.resolve();
    }

    private UriPermission persisted(Uri uri) {
        for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(uri)) return p;
        }
        return null;
    }

    private void resolveStaged(PluginCall call, Uri uri, boolean writable) {
        JSObject o = stage(getContext(), uri);
        if (o == null) {
            call.reject("unreadable");
            return;
        }
        o.put("uri", uri.toString());
        o.put("writable", writable);
        call.resolve(withUrl(o));
    }

    /** Add the http URL the bridge serves a staged file from: a filesystem path means nothing to the WebView. */
    private JSObject withUrl(JSObject o) {
        String path = o.getString("path");
        if (path != null) {
            o.put("url", getBridge().getLocalUrl() != null
                ? com.getcapacitor.FileUtils.getPortablePath(getContext(), getBridge().getLocalUrl(), Uri.fromFile(new File(path)))
                : Uri.fromFile(new File(path)).toString());
        }
        return o;
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
     * Copy what the URI points at into the app cache and describe it. Returns null when the
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
