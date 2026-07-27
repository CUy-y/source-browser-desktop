package cn.ldxp.sourcebrowser.android;

import cn.ldxp.sourcebrowser.android.model.LocalFilters;
import cn.ldxp.sourcebrowser.android.model.ProductRecord;
import cn.ldxp.sourcebrowser.android.util.ProductUtils;

import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public final class ProductUtilsTest {
    @Test public void normalizesSourceFieldsWithoutInventingMissingValues() throws Exception {
        JSONObject raw = new JSONObject("{\"id\":7,\"goods_key\":\"abc\",\"name\":\"K12\",\"price\":\"11.5\",\"cost_price\":9,\"stock_count\":4,\"status\":1,\"user\":{\"nickname\":\"甲店\"},\"category\":{\"name\":\"订阅\"},\"child\":null}");
        ProductRecord product = ProductUtils.normalizeSource(raw, 3);
        assertEquals("7", product.id);
        assertEquals("abc", product.productKey);
        assertEquals(Double.valueOf(11.5), product.salePrice);
        assertEquals(Double.valueOf(9), product.costPrice);
        assertEquals("甲店", product.merchantName);
        assertEquals("订阅", product.categoryName);
        assertEquals("normal", product.status);
        assertEquals("unconnected", product.relation);

        ProductRecord missing = ProductUtils.normalizeSource(new JSONObject("{\"name\":\"空字段\"}"), 0);
        assertNull(missing.salePrice);
        assertNull(missing.costPrice);
        assertNull(missing.stock);
        assertEquals("unknown", missing.status);
        assertEquals("unknown", missing.relation);
    }

    @Test public void appliesPriceBlockedStockFiltersAndStableSorting() throws Exception {
        ProductRecord first = ProductUtils.normalizeSource(new JSONObject("{\"id\":1,\"goods_key\":\"a\",\"name\":\"普通商品\",\"price\":10,\"stock_count\":2,\"status\":1}"), 0);
        ProductRecord second = ProductUtils.normalizeSource(new JSONObject("{\"id\":2,\"goods_key\":\"b\",\"name\":\"镜像商品\",\"price\":8,\"stock_count\":2,\"status\":1}"), 1);
        ProductRecord third = ProductUtils.normalizeSource(new JSONObject("{\"id\":3,\"goods_key\":\"c\",\"name\":\"同价商品\",\"price\":10,\"stock_count\":1,\"status\":1}"), 2);
        LocalFilters filters = new LocalFilters();
        filters.minSalePrice = 9.0;
        filters.maxSalePrice = 10.0;
        filters.blockedKeywords = "镜像，忽略";
        filters.sortMode = "sale-asc";
        List<ProductRecord> result = ProductUtils.applyFilters(Arrays.asList(first, second, third), filters);
        assertEquals(Arrays.asList("a", "c"), Arrays.asList(result.get(0).productKey, result.get(1).productKey));
    }

    @Test public void mergesSourceFirstAndPaginates() throws Exception {
        ProductRecord source = ProductUtils.normalizeSource(new JSONObject("{\"id\":1,\"goods_key\":\"same\",\"name\":\"货源\",\"price\":10}"), 0);
        ProductRecord duplicate = ProductUtils.normalizePublic(new JSONObject("{\"goods_key\":\"same\",\"name\":\"公开重复\",\"price\":9}"), "shop", "店铺", 0, "card");
        ProductRecord publicOnly = ProductUtils.normalizePublic(new JSONObject("{\"goods_key\":\"public\",\"name\":\"公开\",\"price\":8}"), "shop", "店铺", 1, "card");
        List<ProductRecord> merged = ProductUtils.mergeSourceFirst(List.of(source), Arrays.asList(duplicate, publicOnly));
        assertEquals(Arrays.asList("same", "public"), Arrays.asList(merged.get(0).productKey, merged.get(1).productKey));
        assertEquals("货源", merged.get(0).name);
        assertEquals(1, ProductUtils.page(merged, 2, 1).size());
        assertEquals("public", ProductUtils.page(merged, 2, 1).get(0).productKey);
    }
}
