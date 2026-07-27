package cn.ldxp.sourcebrowser.android.data;

import android.content.Context;
import android.content.SharedPreferences;

import cn.ldxp.sourcebrowser.android.model.LocalFilters;

public final class SettingsStore {
    private final SharedPreferences preferences;

    public SettingsStore(Context context) {
        preferences = context.getApplicationContext().getSharedPreferences("query-settings-v1", Context.MODE_PRIVATE);
    }

    public int getInt(String key, int fallback) { return preferences.getInt(key, fallback); }
    public String getString(String key, String fallback) { return preferences.getString(key, fallback); }
    public void putInt(String key, int value) { preferences.edit().putInt(key, value).apply(); }
    public void putString(String key, String value) { preferences.edit().putString(key, value).apply(); }

    public LocalFilters loadFilters() {
        LocalFilters filters = new LocalFilters();
        filters.minSalePrice = nullable("minSalePrice");
        filters.maxSalePrice = nullable("maxSalePrice");
        filters.stockState = getString("stockState", "in-stock");
        filters.status = getString("status", "normal");
        filters.relationState = getString("relationState", "all");
        filters.categoryKeyword = getString("categoryKeyword", "");
        filters.merchantName = getString("merchantName", "");
        filters.blockedKeywords = getString("blockedKeywords", "");
        filters.sortMode = getString("sortMode", "default");
        return filters;
    }

    public void saveFilters(LocalFilters filters) {
        SharedPreferences.Editor editor = preferences.edit();
        putNullable(editor, "minSalePrice", filters.minSalePrice);
        putNullable(editor, "maxSalePrice", filters.maxSalePrice);
        editor.putString("stockState", filters.stockState);
        editor.putString("status", filters.status);
        editor.putString("relationState", filters.relationState);
        editor.putString("categoryKeyword", filters.categoryKeyword);
        editor.putString("merchantName", filters.merchantName);
        editor.putString("blockedKeywords", filters.blockedKeywords);
        editor.putString("sortMode", filters.sortMode);
        editor.apply();
    }

    private Double nullable(String key) {
        String value = getString(key, "");
        if (value == null || value.isEmpty()) return null;
        try { return Double.parseDouble(value); } catch (NumberFormatException ignored) { return null; }
    }

    private static void putNullable(SharedPreferences.Editor editor, String key, Double value) {
        editor.putString(key, value == null ? "" : String.valueOf(value));
    }
}
