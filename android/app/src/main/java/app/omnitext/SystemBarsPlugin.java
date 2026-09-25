package app.omnitext;

import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The status and navigation bars while the app is in fullscreen. A WebView knows nothing
// about the page's Fullscreen API: an element going fullscreen fills the WebView, and the
// system bars stay on top of the video. The web app calls this when that happens, so a
// fullscreen video looks like it does in any other player. A swipe brings the bars back.
//
// Hiding the bars alone leaves the band around the camera cut-out reserved, as a grey margin
// beside the picture, and letting the window into the cut-out is not enough either: the decor
// view pads itself away from it on every inset pass. While fullscreen the insets are consumed
// and that padding dropped; on exit the view's own handling takes over again.
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    // The cut-out padding the decor view had before fullscreen, put back on the way out.
    private int[] savedPadding = null;

    @PluginMethod
    public void setImmersive(PluginCall call) {
        final boolean value = call.getBoolean("value", false);
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            View decor = window.getDecorView();
            if (value) {
                if (savedPadding == null)
                    savedPadding = new int[] {
                        decor.getPaddingLeft(), decor.getPaddingTop(),
                        decor.getPaddingRight(), decor.getPaddingBottom(),
                    };
                // Consume the insets so the decor stops padding itself away from the cut-out.
                ViewCompat.setOnApplyWindowInsetsListener(decor, (view, insets) -> {
                    view.setPadding(0, 0, 0, 0);
                    return WindowInsetsCompat.CONSUMED;
                });
                decor.setPadding(0, 0, 0, 0);
            } else {
                ViewCompat.setOnApplyWindowInsetsListener(decor, null); // back to the view's own handling
                if (savedPadding != null) {
                    decor.setPadding(savedPadding[0], savedPadding[1], savedPadding[2], savedPadding[3]);
                    savedPadding = null;
                }
            }
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            WindowCompat.setDecorFitsSystemWindows(window, !value);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                WindowManager.LayoutParams params = window.getAttributes();
                // ALWAYS, not SHORT_EDGES: the cut-out sits on a long edge in landscape,
                // which is exactly where a fullscreen video is watched.
                final int into = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                        ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                        : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                params.layoutInDisplayCutoutMode = value ? into : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
                window.setAttributes(params);
            }
            if (value) controller.hide(WindowInsetsCompat.Type.systemBars());
            else controller.show(WindowInsetsCompat.Type.systemBars());
            ViewCompat.requestApplyInsets(decor);
        });
        call.resolve();
    }
}
