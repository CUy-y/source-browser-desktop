package cn.ldxp.sourcebrowser.android.model;

public final class SearchRequest {
    public final String keywords;
    public final String goodsType;
    public final int pages;
    public final int remotePageSize;
    public final String speedMode;
    public final String searchScope;

    public SearchRequest(String keywords, String goodsType, int pages, int remotePageSize, String speedMode, String searchScope) {
        this.keywords = keywords == null ? "" : keywords.trim();
        this.goodsType = goodsType == null ? "" : goodsType.trim();
        this.pages = pages;
        this.remotePageSize = remotePageSize;
        this.speedMode = speedMode;
        this.searchScope = searchScope;
    }

    public void validate() {
        if (keywords.isEmpty()) throw new IllegalArgumentException("请输入关键词");
        if (keywords.length() > 100) throw new IllegalArgumentException("关键词不能超过 100 个字符");
        if (pages < 1 || pages > 100) throw new IllegalArgumentException("拉取页数必须是 1–100 的整数");
        if (remotePageSize != 20 && remotePageSize != 50 && remotePageSize != 100) throw new IllegalArgumentException("远端每页数量不正确");
        if (!speedMode.equals("stable") && !speedMode.equals("standard") && !speedMode.equals("fast")) throw new IllegalArgumentException("拉取速度不正确");
        if (!searchScope.equals("source") && !searchScope.equals("public") && !searchScope.equals("all")) throw new IllegalArgumentException("查询范围不正确");
    }
}
