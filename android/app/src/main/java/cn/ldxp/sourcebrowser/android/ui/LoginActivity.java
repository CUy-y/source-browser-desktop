package cn.ldxp.sourcebrowser.android.ui;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.TextView;

import cn.ldxp.sourcebrowser.android.R;
import cn.ldxp.sourcebrowser.android.auth.Credential;
import cn.ldxp.sourcebrowser.android.network.ApiClient;
import cn.ldxp.sourcebrowser.android.network.ApiEnvelope;
import cn.ldxp.sourcebrowser.android.util.UrlPolicy;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class LoginActivity extends Activity {
    private static final String LOGIN_URL = "https://pay.ldxp.cn/merchant/login";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Runnable captureLoop = new Runnable() {
        @Override public void run() {
            captureToken();
            handler.postDelayed(this, 1500);
        }
    };
    private WebView webView;
    private ProgressBar progress;
    private TextView message;
    private ApiClient api;
    private boolean validating;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_login);
        UiUtils.applySystemInsets(this, findViewById(android.R.id.content));
        WebView.setWebContentsDebuggingEnabled(false);
        api = new ApiClient(this);
        webView = findViewById(R.id.login_webview);
        progress = findViewById(R.id.login_progress);
        message = findViewById(R.id.login_message);
        String initialMessage = getIntent().getStringExtra("message");
        if (initialMessage != null && !initialMessage.isEmpty()) message.setText(initialMessage);
        configureWebView();
        findViewById(R.id.login_reload).setOnClickListener(view -> webView.reload());
        if (state == null) webView.loadUrl(LOGIN_URL);
        handler.post(captureLoop);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::handleBack);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setSaveFormData(false);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int newProgress) {
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl().toString());
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(url);
            }

            @Override public void onPageFinished(WebView view, String url) {
                captureToken();
            }
        });
    }

    private boolean handleNavigation(String url) {
        if (UrlPolicy.isMerchantWebViewUrl(url)) return false;
        if (UrlPolicy.isOfficialHttps(url)) UiUtils.openOfficialUrl(this, url);
        return true;
    }

    private void captureToken() {
        if (validating || webView == null || !UrlPolicy.isMerchantWebViewUrl(webView.getUrl())) return;
        String script = "(function(){try{var raw=localStorage.getItem('auth-token');if(!raw)return '';var parsed=JSON.parse(raw);var token=typeof parsed==='string'?parsed:(parsed&&parsed.value);var expiresAt=parsed&&typeof parsed.expiry==='number'?parsed.expiry:0;return token?JSON.stringify({token:token,expiresAt:expiresAt}):'';}catch(e){return '';}})();";
        webView.evaluateJavascript(script, value -> {
            try {
                Object decoded = new JSONTokener(value).nextValue();
                String json = decoded instanceof String ? (String) decoded : "";
                if (json.isEmpty()) return;
                JSONObject extracted = new JSONObject(json);
                String token = extracted.optString("token", "");
                if (token.isEmpty()) return;
                validateToken(token, extracted.optLong("expiresAt", 0));
            } catch (Exception ignored) { }
        });
    }

    private void validateToken(String token, long expiresAt) {
        if (validating) return;
        validating = true;
        message.setText("正在验证官方登录状态…");
        executor.submit(() -> {
            try {
                ApiEnvelope response = api.postWithToken("/merchantApi/user/userinfo", new JSONObject(), token, new AtomicBoolean(false));
                if (response.code != 1 || !(response.data instanceof JSONObject)) throw new IllegalStateException(response.message.isEmpty() ? "无法验证登录状态" : response.message);
                JSONObject profile = (JSONObject) response.data;
                String username = first(profile, "merchant", "username", "mobile", "id");
                String displayName = first(profile, "链动商家", "nickname", "username", "mobile");
                api.tokenStore().save(new Credential(token, username, displayName, expiresAt));
                handler.post(() -> {
                    CookieManager.getInstance().flush();
                    startActivity(new Intent(this, MainActivity.class));
                    finish();
                });
            } catch (Exception error) {
                handler.post(() -> {
                    validating = false;
                    message.setText("登录验证尚未完成，请继续在官方页面操作");
                });
            }
        });
    }

    private static String first(JSONObject value, String fallback, String... keys) {
        for (String key : keys) {
            String text = value.optString(key, "").trim();
            if (!text.isEmpty()) return text;
        }
        return fallback;
    }

    private void handleBack() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else finish();
    }

    @SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() {
        handleBack();
    }

    @Override protected void onDestroy() {
        handler.removeCallbacks(captureLoop);
        executor.shutdownNow();
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
        }
        super.onDestroy();
    }
}
