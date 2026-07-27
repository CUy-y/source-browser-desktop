package cn.ldxp.sourcebrowser.android.model;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public final class PublicShopSnapshot {
    public String token = "";
    public String name = "";
    public String url = "";
    public long createdAt;
    public long updatedAt;
    public String lastError = "";
    public final List<ProductRecord> products = new ArrayList<>();

    public JSONObject toJson() throws JSONException {
        JSONObject value = new JSONObject();
        value.put("token", token);
        value.put("name", name);
        value.put("url", url);
        value.put("createdAt", createdAt);
        value.put("updatedAt", updatedAt);
        value.put("lastError", lastError);
        JSONArray items = new JSONArray();
        for (ProductRecord product : products) items.put(product.toJson());
        value.put("products", items);
        return value;
    }

    public static PublicShopSnapshot fromJson(JSONObject value) {
        PublicShopSnapshot shop = new PublicShopSnapshot();
        shop.token = value.optString("token", "");
        shop.name = value.optString("name", shop.token);
        shop.url = value.optString("url", "");
        shop.createdAt = value.optLong("createdAt", System.currentTimeMillis());
        shop.updatedAt = value.optLong("updatedAt", shop.createdAt);
        shop.lastError = value.optString("lastError", "");
        JSONArray products = value.optJSONArray("products");
        if (products != null) {
            for (int index = 0; index < products.length(); index++) {
                JSONObject product = products.optJSONObject(index);
                if (product != null) shop.products.add(ProductRecord.fromJson(product));
            }
        }
        return shop;
    }
}
