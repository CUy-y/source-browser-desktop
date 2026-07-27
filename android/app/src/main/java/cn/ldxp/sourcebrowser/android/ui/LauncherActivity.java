package cn.ldxp.sourcebrowser.android.ui;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.TextView;

import cn.ldxp.sourcebrowser.android.R;
import cn.ldxp.sourcebrowser.android.auth.Credential;
import cn.ldxp.sourcebrowser.android.network.ApiClient;
import cn.ldxp.sourcebrowser.android.network.ApiEnvelope;
import cn.ldxp.sourcebrowser.android.network.ApiException;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class LauncherActivity extends Activity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private ApiClient api;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_launcher);
        UiUtils.applySystemInsets(this, findViewById(android.R.id.content));
        api = new ApiClient(this);
        Credential stored = api.tokenStore().load();
        if (stored == null) {
            openLogin();
            return;
        }
        validate(stored);
    }

    private void validate(Credential stored) {
        executor.submit(() -> {
            try {
                ApiEnvelope response = api.postWithToken("/merchantApi/user/userinfo", new JSONObject(), stored.token, new AtomicBoolean(false));
                if (response.code != 1 || !(response.data instanceof JSONObject)) {
                    api.tokenStore().clear();
                    main.post(this::openLogin);
                    return;
                }
                JSONObject profile = (JSONObject) response.data;
                String username = first(profile, stored.username, "username", "mobile", "id");
                String displayName = first(profile, stored.displayName, "nickname", "username", "mobile");
                api.tokenStore().save(new Credential(stored.token, username, displayName, stored.expiresAt));
                main.post(() -> openMain(""));
            } catch (ApiException error) {
                if (error.requiresLogin()) {
                    api.tokenStore().clear();
                    main.post(this::openLogin);
                } else {
                    main.post(() -> openMain("暂时无法连接链动小铺，已保留本机登录态"));
                }
            } catch (Exception error) {
                main.post(() -> openMain("暂时无法连接链动小铺，已保留本机登录态"));
            }
        });
    }

    private void openLogin() {
        startActivity(new Intent(this, LoginActivity.class));
        finish();
    }

    private void openMain(String warning) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra("connection_warning", warning);
        startActivity(intent);
        finish();
    }

    private static String first(JSONObject value, String fallback, String... keys) {
        for (String key : keys) {
            String text = value.optString(key, "").trim();
            if (!text.isEmpty()) return text;
        }
        return fallback;
    }

    @Override protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
