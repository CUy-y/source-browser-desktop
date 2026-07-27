package cn.ldxp.sourcebrowser.android.model;

public final class LocalFilters {
    public Double minSalePrice;
    public Double maxSalePrice;
    public String stockState = "in-stock";
    public String status = "normal";
    public String relationState = "all";
    public String categoryKeyword = "";
    public String merchantName = "";
    public String blockedKeywords = "";
    public String sortMode = "default";

    public LocalFilters copy() {
        LocalFilters copy = new LocalFilters();
        copy.minSalePrice = minSalePrice;
        copy.maxSalePrice = maxSalePrice;
        copy.stockState = stockState;
        copy.status = status;
        copy.relationState = relationState;
        copy.categoryKeyword = categoryKeyword;
        copy.merchantName = merchantName;
        copy.blockedKeywords = blockedKeywords;
        copy.sortMode = sortMode;
        return copy;
    }

    public void validate() {
        if (minSalePrice != null && maxSalePrice != null && minSalePrice > maxSalePrice) {
            throw new IllegalArgumentException("售价下限不能高于售价上限");
        }
    }
}
