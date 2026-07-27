package cn.ldxp.sourcebrowser.android.auth;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class TokenStore {
    private static final String KEY_ALIAS = "ldxp-source-browser-auth-v1";
    private static final String PREFS = "secure-session";
    private static final String VALUE = "credential";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private final SharedPreferences preferences;

    public TokenStore(Context context) {
        preferences = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized Credential load() {
        String encoded = preferences.getString(VALUE, "");
        if (encoded == null || encoded.isEmpty()) return null;
        try {
            byte[] payload = Base64.decode(encoded, Base64.NO_WRAP);
            if (payload.length < 13) throw new IllegalStateException("credential payload is truncated");
            byte[] iv = new byte[12];
            byte[] cipherText = new byte[payload.length - iv.length];
            System.arraycopy(payload, 0, iv, 0, iv.length);
            System.arraycopy(payload, iv.length, cipherText, 0, cipherText.length);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
            JSONObject value = new JSONObject(new String(cipher.doFinal(cipherText), StandardCharsets.UTF_8));
            Credential credential = new Credential(
                value.optString("token", ""),
                value.optString("username", "merchant"),
                value.optString("displayName", "链动商家"),
                value.optLong("expiresAt", 0)
            );
            if (credential.token.isEmpty() || credential.isExpired()) {
                clear();
                return null;
            }
            return credential;
        } catch (Exception ignored) {
            clear();
            return null;
        }
    }

    public synchronized void save(Credential credential) throws Exception {
        JSONObject value = new JSONObject();
        value.put("token", credential.token);
        value.put("username", credential.username);
        value.put("displayName", credential.displayName);
        value.put("expiresAt", credential.expiresAt);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] cipherText = cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        byte[] payload = new byte[iv.length + cipherText.length];
        System.arraycopy(iv, 0, payload, 0, iv.length);
        System.arraycopy(cipherText, 0, payload, iv.length, cipherText.length);
        preferences.edit().putString(VALUE, Base64.encodeToString(payload, Base64.NO_WRAP)).apply();
    }

    public synchronized void clear() {
        preferences.edit().remove(VALUE).apply();
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }
}
