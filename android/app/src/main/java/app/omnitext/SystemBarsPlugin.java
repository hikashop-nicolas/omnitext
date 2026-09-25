package app.omnitext;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.View;
import android.view.Window;

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
// The band the system keeps for the camera cut-out cannot be claimed from here: letting the
// window lay out into it leaves the navigation bar's backdrop painted across the app once
// fullscreen is left. It is painted black instead, where it reads as part of the letterbox.
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    private Integer savedStatusColor = null;
    private Integer savedNavColor = null;

    @PluginMethod
    public void setImmersive(PluginCall call) {
        final boolean immersive = call.getBoolean("value", false);
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            View decor = window.getDecorView();
            if (immersive) {
                if (savedStatusColor == null) {
                    savedStatusColor = window.getStatusBarColor();
                    savedNavColor = window.getNavigationBarColor();
                }
                window.setBackgroundDrawable(new ColorDrawable(Color.BLACK));
                window.setStatusBarColor(Color.BLACK);
                window.setNavigationBarColor(Color.BLACK);
            } else if (savedStatusColor != null) {
                window.setStatusBarColor(savedStatusColor);
                window.setNavigationBarColor(savedNavColor);
                savedStatusColor = null;
                savedNavColor = null;
            }
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decor);
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            if (immersive) controller.hide(WindowInsetsCompat.Type.systemBars());
            else controller.show(WindowInsetsCompat.Type.systemBars());
        });
        call.resolve();
    }
}
