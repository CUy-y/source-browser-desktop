package cn.ldxp.sourcebrowser.android.publicdata;

import android.content.Context;
import android.system.Os;

import cn.ldxp.sourcebrowser.android.model.PublicShopSnapshot;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class PublicCatalogStore {
    private final File file;
    private final Map<String, PublicShopSnapshot> shops = new LinkedHashMap<>();

    public PublicCatalogStore(Context context) {
        this(new File(context.getApplicationContext().getFilesDir(), "public-catalog-v1.json"));
    }

    PublicCatalogStore(File file) {
        this.file = file;
        reload();
    }

    public synchronized void reload() {
        read();
    }

    public synchronized List<PublicShopSnapshot> getShops() {
        List<PublicShopSnapshot> values = new ArrayList<>(shops.values());
        values.sort(Comparator.comparingLong((PublicShopSnapshot shop) -> shop.updatedAt).reversed());
        return values;
    }

    public synchronized PublicShopSnapshot find(String token) {
        return shops.get(token);
    }

    public synchronized void upsert(PublicShopSnapshot shop) throws Exception {
        shops.put(shop.token, shop);
        write();
    }

    public synchronized void markError(String token, String message) {
        PublicShopSnapshot shop = shops.get(token);
        if (shop == null) return;
        shop.lastError = message == null ? "刷新失败" : message.substring(0, Math.min(500, message.length()));
        try { write(); } catch (Exception ignored) { }
    }

    public synchronized void remove(String token) throws Exception {
        shops.remove(token);
        write();
    }

    private void read() {
        shops.clear();
        if (!file.isFile()) return;
        try {
            byte[] bytes;
            try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
                bytes = output.toByteArray();
            }
            JSONObject root = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            JSONArray values = root.optJSONArray("shops");
            if (values == null) return;
            for (int index = 0; index < values.length(); index++) {
                JSONObject raw = values.optJSONObject(index);
                if (raw == null) continue;
                PublicShopSnapshot shop = PublicShopSnapshot.fromJson(raw);
                if (!shop.token.isEmpty()) shops.put(shop.token, shop);
            }
        } catch (Exception ignored) {
            shops.clear();
        }
    }

    private void write() throws Exception {
        JSONObject root = new JSONObject();
        root.put("version", 1);
        JSONArray values = new JSONArray();
        for (PublicShopSnapshot shop : shops.values()) values.put(shop.toJson());
        root.put("shops", values);
        File temporary = new File(file.getParentFile(), file.getName() + ".tmp");
        byte[] bytes = root.toString().getBytes(StandardCharsets.UTF_8);
        try (FileOutputStream output = new FileOutputStream(temporary, false)) {
            output.write(bytes);
            output.flush();
            output.getFD().sync();
        }
        Os.rename(temporary.getAbsolutePath(), file.getAbsolutePath());
    }
}
