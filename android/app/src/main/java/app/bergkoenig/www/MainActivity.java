package app.bergkoenig.www;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // WebView-Textzoom fest auf 100% — sonst uebernimmt die WebView die
        // System-Schriftgroesse des Geraets und skaliert ALLES hoch (Schrift,
        // Icons, Kopfzeile), wodurch das untere Menue aus dem Bild rutscht.
        // Im Browser ist die Darstellung bereits korrekt; so matcht die App das.
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().getSettings().setTextZoom(100);
        }
    }
}
