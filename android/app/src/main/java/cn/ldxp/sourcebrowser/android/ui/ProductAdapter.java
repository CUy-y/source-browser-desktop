package cn.ldxp.sourcebrowser.android.ui;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.TextView;

import cn.ldxp.sourcebrowser.android.R;
import cn.ldxp.sourcebrowser.android.model.ProductRecord;

import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class ProductAdapter extends BaseAdapter {
    public interface DetailListener { void open(ProductRecord product); }
    private final LayoutInflater inflater;
    private final DetailListener listener;
    private final NumberFormat currency = NumberFormat.getCurrencyInstance(Locale.CHINA);
    private List<ProductRecord> products = new ArrayList<>();

    public ProductAdapter(Context context, DetailListener listener) {
        inflater = LayoutInflater.from(context);
        this.listener = listener;
        currency.setMaximumFractionDigits(2);
        currency.setMinimumFractionDigits(0);
    }

    public void setProducts(List<ProductRecord> products) {
        this.products = new ArrayList<>(products);
        notifyDataSetChanged();
    }

    @Override public int getCount() { return products.size(); }
    @Override public ProductRecord getItem(int position) { return products.get(position); }
    @Override public long getItemId(int position) { return position; }

    @Override public View getView(int position, View convertView, ViewGroup parent) {
        Holder holder;
        if (convertView == null) {
            convertView = inflater.inflate(R.layout.item_product, parent, false);
            holder = new Holder(convertView);
            convertView.setTag(holder);
        } else holder = (Holder) convertView.getTag();
        ProductRecord product = getItem(position);
        holder.source.setText(product.dataSource.equals("public-shop") ? "公开零售" : "货源广场");
        holder.title.setText(product.name);
        holder.shop.setText((empty(product.merchantName) ? "—" : product.merchantName) + " · " + (empty(product.categoryName) ? "—" : product.categoryName));
        holder.prices.setText("售价 " + money(product.salePrice) + "   成本 " + money(product.costPrice));
        String relation = product.dataSource.equals("public-shop") ? "不可关联" : product.relation.equals("connected") ? "已关联" : product.relation.equals("unconnected") ? "未关联" : "未知";
        holder.meta.setText("库存 " + integer(product.stock) + " · 销量 " + integer(product.sales) + " · " + product.statusLabel + " · " + relation);
        boolean hasDetail = !empty(product.detailUrl);
        holder.detail.setEnabled(hasDetail);
        holder.detail.setOnClickListener(view -> { if (hasDetail) listener.open(product); });
        holder.title.setOnClickListener(view -> { if (hasDetail) listener.open(product); });
        return convertView;
    }

    private String money(Double value) { return value == null ? "—" : currency.format(value); }
    private static String integer(Double value) { return value == null ? "—" : String.valueOf(value.longValue()); }
    private static boolean empty(String value) { return value == null || value.isEmpty(); }

    private static final class Holder {
        final TextView source;
        final TextView title;
        final TextView shop;
        final TextView prices;
        final TextView meta;
        final Button detail;
        Holder(View view) {
            source = view.findViewById(R.id.product_source);
            title = view.findViewById(R.id.product_title);
            shop = view.findViewById(R.id.product_shop);
            prices = view.findViewById(R.id.product_prices);
            meta = view.findViewById(R.id.product_meta);
            detail = view.findViewById(R.id.product_detail);
        }
    }
}
