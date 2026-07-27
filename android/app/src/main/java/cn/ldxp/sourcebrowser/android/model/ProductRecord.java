package cn.ldxp.sourcebrowser.android.model;

import org.json.JSONException;
import org.json.JSONObject;

public final class ProductRecord {
    public String id = "";
    public String productKey = "";
    public String name = "";
    public String merchantName = "";
    public String categoryName = "";
    public String goodsType = "";
    public String description = "";
    public Double salePrice;
    public Double costPrice;
    public Double agentPriceLimit;
    public Double stock;
    public Double sales;
    public String status = "unknown";
    public String statusLabel = "未知";
    public String relation = "unknown";
    public String detailUrl = "";
    public int sourceIndex;
    public String dataSource = "source-square";
    public String publicShopToken = "";

    public String identity() {
        return productKey.isEmpty() ? "id:" + id : "key:" + productKey;
    }

    public JSONObject toJson() throws JSONException {
        JSONObject value = new JSONObject();
        value.put("id", id);
        value.put("productKey", productKey);
        value.put("name", name);
        value.put("merchantName", merchantName);
        value.put("categoryName", categoryName);
        value.put("goodsType", goodsType);
        value.put("description", description);
        putNullable(value, "salePrice", salePrice);
        putNullable(value, "costPrice", costPrice);
        putNullable(value, "agentPriceLimit", agentPriceLimit);
        putNullable(value, "stock", stock);
        putNullable(value, "sales", sales);
        value.put("status", status);
        value.put("statusLabel", statusLabel);
        value.put("relation", relation);
        value.put("detailUrl", detailUrl);
        value.put("sourceIndex", sourceIndex);
        value.put("dataSource", dataSource);
        value.put("publicShopToken", publicShopToken);
        return value;
    }

    public static ProductRecord fromJson(JSONObject value) {
        ProductRecord product = new ProductRecord();
        product.id = value.optString("id", "");
        product.productKey = value.optString("productKey", "");
        product.name = value.optString("name", "未命名商品");
        product.merchantName = value.optString("merchantName", "");
        product.categoryName = value.optString("categoryName", "");
        product.goodsType = value.optString("goodsType", "");
        product.description = value.optString("description", "");
        product.salePrice = nullable(value, "salePrice");
        product.costPrice = nullable(value, "costPrice");
        product.agentPriceLimit = nullable(value, "agentPriceLimit");
        product.stock = nullable(value, "stock");
        product.sales = nullable(value, "sales");
        product.status = value.optString("status", "unknown");
        product.statusLabel = value.optString("statusLabel", "未知");
        product.relation = value.optString("relation", "unknown");
        product.detailUrl = value.optString("detailUrl", "");
        product.sourceIndex = Math.max(0, value.optInt("sourceIndex", 0));
        product.dataSource = value.optString("dataSource", "public-shop");
        product.publicShopToken = value.optString("publicShopToken", "");
        return product;
    }

    private static void putNullable(JSONObject target, String key, Double value) throws JSONException {
        target.put(key, value == null ? JSONObject.NULL : value);
    }

    private static Double nullable(JSONObject source, String key) {
        if (!source.has(key) || source.isNull(key)) return null;
        double value = source.optDouble(key, Double.NaN);
        return Double.isFinite(value) ? value : null;
    }
}
