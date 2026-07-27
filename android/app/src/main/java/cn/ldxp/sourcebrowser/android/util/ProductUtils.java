package cn.ldxp.sourcebrowser.android.util;

import cn.ldxp.sourcebrowser.android.model.LocalFilters;
import cn.ldxp.sourcebrowser.android.model.ProductRecord;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public final class ProductUtils {
    private ProductUtils() {}

    public static ProductRecord normalizeSource(JSONObject raw, int sourceIndex) {
        ProductRecord product = new ProductRecord();
        product.id = text(first(raw, "id", "goods_id", "product_id"));
        if (product.id.isEmpty()) product.id = "row-" + (sourceIndex + 1);
        product.productKey = text(first(raw, "goods_key", "key", "product_key"));
        product.name = text(first(raw, "name", "goods_name", "title"));
        if (product.name.isEmpty()) product.name = "未命名商品";
        product.merchantName = nestedText(raw, new String[][]{{"user", "nickname"}, {"parent", "nickname"}, {"merchant", "name"}, {"shop", "name"}});
        if (product.merchantName.isEmpty()) product.merchantName = text(first(raw, "shop_name", "merchant_name"));
        product.categoryName = nestedText(raw, new String[][]{{"category", "name"}});
        if (product.categoryName.isEmpty()) product.categoryName = text(first(raw, "category_name", "goods_category_name"));
        product.goodsType = text(first(raw, "goods_type", "type"));
        product.description = text(first(raw, "description", "goods_description", "content"));
        product.salePrice = number(first(raw, "price", "sale_price", "real_price"));
        JSONObject child = raw.optJSONObject("child");
        if (product.salePrice == null && child != null) product.salePrice = number(child.opt("price"));
        product.costPrice = number(first(raw, "cost_price", "agent_price", "purchase_price"));
        product.agentPriceLimit = number(first(raw, "agent_price_limit", "price_limit"));
        product.stock = number(first(raw, "stock_count", "stock", "count", "inventory"));
        product.sales = number(first(raw, "sales_count", "sale_count", "sold_count", "sales"));
        Double status = number(first(raw, "status", "goods_status"));
        Double verify = number(first(raw, "verify", "verified", "audit_status"));
        if (verify != null && verify != 1) product.status = "abnormal";
        else if (status == null) product.status = "unknown";
        else product.status = status == 1 ? "normal" : "abnormal";
        product.statusLabel = product.status.equals("normal") ? "正常" : product.status.equals("abnormal") ? "异常" : "未知";
        boolean connected = child != null || raw.optInt("is_connect", -1) == 1 || raw.optBoolean("connected", false);
        boolean explicitlyUnconnected = (raw.has("child") && raw.isNull("child")) || raw.optInt("is_connect", -1) == 0 || (raw.has("connected") && !raw.optBoolean("connected", true));
        product.relation = connected ? "connected" : explicitlyUnconnected ? "unconnected" : "unknown";
        String direct = text(first(raw, "link", "detail_url", "url"));
        product.detailUrl = direct.isEmpty() && !product.productKey.isEmpty() ? "https://pay.ldxp.cn/item/" + product.productKey : direct;
        product.sourceIndex = sourceIndex;
        product.dataSource = "source-square";
        return product;
    }

    public static ProductRecord normalizePublic(JSONObject raw, String shopToken, String shopName, int sourceIndex, String fallbackType) {
        ProductRecord product = new ProductRecord();
        product.productKey = text(first(raw, "goods_key", "key"));
        product.id = text(first(raw, "id", "goods_id"));
        if (product.id.isEmpty()) product.id = product.productKey.isEmpty() ? "public-row-" + (sourceIndex + 1) : "public-" + product.productKey;
        product.name = text(first(raw, "name", "goods_name", "title"));
        if (product.name.isEmpty()) product.name = "未命名商品";
        product.merchantName = nestedText(raw, new String[][]{{"user", "nickname"}, {"user", "name"}});
        if (product.merchantName.isEmpty()) product.merchantName = shopName.isEmpty() ? shopToken : shopName;
        product.categoryName = nestedText(raw, new String[][]{{"category", "name"}});
        if (product.categoryName.isEmpty()) product.categoryName = text(raw.opt("category_name"));
        product.goodsType = text(first(raw, "goods_type", "type"));
        if (product.goodsType.isEmpty()) product.goodsType = fallbackType;
        product.description = text(first(raw, "description", "content"));
        product.salePrice = number(first(raw, "price", "real_price", "sale_price"));
        JSONObject extend = raw.optJSONObject("extend");
        product.stock = number(extend == null ? first(raw, "stock_count", "stock") : first(extend, "stock_count", "stock"));
        product.sales = number(first(raw, "sales_count", "sale_count", "sales"));
        Double status = number(first(raw, "status", "goods_status"));
        Double verify = number(first(raw, "verify", "audit_status"));
        product.status = (verify != null && verify != 1) || (status != null && status != 1) ? "abnormal" : "normal";
        product.statusLabel = product.status.equals("normal") ? "正常" : "异常";
        product.relation = "unknown";
        product.detailUrl = text(first(raw, "link", "url"));
        if (product.detailUrl.isEmpty() && !product.productKey.isEmpty()) product.detailUrl = "https://pay.ldxp.cn/item/" + product.productKey;
        product.sourceIndex = sourceIndex;
        product.dataSource = "public-shop";
        product.publicShopToken = shopToken;
        return product;
    }

    public static List<ProductRecord> applyFilters(List<ProductRecord> products, LocalFilters filters) {
        filters.validate();
        String category = lower(filters.categoryKeyword);
        String merchant = lower(filters.merchantName);
        List<String> blocked = blockedWords(filters.blockedKeywords);
        List<ProductRecord> result = new ArrayList<>();
        for (ProductRecord product : products) {
            if (filters.stockState.equals("in-stock") && !(product.stock != null && product.stock > 0)) continue;
            if (filters.stockState.equals("out-of-stock") && !(product.stock != null && product.stock == 0)) continue;
            if (!filters.status.equals("all") && !filters.status.equals(product.status)) continue;
            if (!filters.relationState.equals("all") && (product.dataSource.equals("public-shop") || !filters.relationState.equals(product.relation))) continue;
            if (!category.isEmpty() && !lower(product.categoryName).contains(category)) continue;
            if (!merchant.isEmpty() && !lower(product.merchantName).contains(merchant)) continue;
            if (filters.minSalePrice != null && (product.salePrice == null || product.salePrice < filters.minSalePrice)) continue;
            if (filters.maxSalePrice != null && (product.salePrice == null || product.salePrice > filters.maxSalePrice)) continue;
            String haystack = lower(product.name + "\n" + product.categoryName + "\n" + product.merchantName);
            boolean hidden = false;
            for (String word : blocked) if (haystack.contains(word)) { hidden = true; break; }
            if (!hidden) result.add(product);
        }
        if (!filters.sortMode.equals("default")) {
            int direction = filters.sortMode.equals("sale-asc") ? 1 : -1;
            result.sort((left, right) -> {
                if (left.salePrice == null && right.salePrice == null) return Integer.compare(left.sourceIndex, right.sourceIndex);
                if (left.salePrice == null) return 1;
                if (right.salePrice == null) return -1;
                int price = Double.compare(left.salePrice, right.salePrice) * direction;
                return price != 0 ? price : Integer.compare(left.sourceIndex, right.sourceIndex);
            });
        }
        return result;
    }

    public static List<ProductRecord> mergeSourceFirst(List<ProductRecord> source, List<ProductRecord> publicProducts) {
        List<ProductRecord> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (ProductRecord product : concat(source, publicProducts)) {
            if (!seen.add(product.identity())) continue;
            product.sourceIndex = result.size();
            result.add(product);
        }
        return result;
    }

    public static List<ProductRecord> page(List<ProductRecord> products, int page, int pageSize) {
        int safePage = Math.max(1, page);
        int start = Math.min(products.size(), (safePage - 1) * pageSize);
        int end = Math.min(products.size(), start + pageSize);
        return new ArrayList<>(products.subList(start, end));
    }

    public static List<ProductRecord> deduplicate(List<ProductRecord> products) {
        List<ProductRecord> result = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (ProductRecord product : products) if (seen.add(product.identity())) result.add(product);
        return result;
    }

    private static List<ProductRecord> concat(List<ProductRecord> left, List<ProductRecord> right) {
        List<ProductRecord> values = new ArrayList<>(left.size() + right.size());
        values.addAll(left);
        values.addAll(right);
        return values;
    }

    private static List<String> blockedWords(String value) {
        List<String> words = new ArrayList<>();
        for (String word : value.split("[,，\\n]")) {
            String normalized = lower(word.trim());
            if (!normalized.isEmpty() && !words.contains(normalized)) words.add(normalized);
        }
        return words;
    }

    private static Object first(JSONObject value, String... keys) {
        for (String key : keys) {
            Object candidate = value.opt(key);
            if (candidate != null && candidate != JSONObject.NULL && !text(candidate).isEmpty()) return candidate;
        }
        return null;
    }

    private static String nestedText(JSONObject root, String[][] paths) {
        for (String[] path : paths) {
            JSONObject object = root.optJSONObject(path[0]);
            if (object == null) continue;
            String value = text(object.opt(path[1]));
            if (!value.isEmpty()) return value;
        }
        return "";
    }

    private static String text(Object value) {
        if (value == null || value == JSONObject.NULL) return "";
        if (value instanceof String || value instanceof Number) return String.valueOf(value).trim();
        return "";
    }

    private static Double number(Object value) {
        if (value == null || value == JSONObject.NULL || text(value).isEmpty()) return null;
        try {
            double number = Double.parseDouble(String.valueOf(value));
            return Double.isFinite(number) ? number : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static String lower(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}
