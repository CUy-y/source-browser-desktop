package cn.ldxp.sourcebrowser.android.ui;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.TextView;

import cn.ldxp.sourcebrowser.android.R;
import cn.ldxp.sourcebrowser.android.model.PublicShopSnapshot;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public final class PublicShopAdapter extends BaseAdapter {
    public interface Actions {
        void refresh(PublicShopSnapshot shop);
        void open(PublicShopSnapshot shop);
        void remove(PublicShopSnapshot shop);
    }
    private final LayoutInflater inflater;
    private final Actions actions;
    private final DateFormat dateFormat = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, Locale.CHINA);
    private List<PublicShopSnapshot> shops = new ArrayList<>();
    private boolean busy;

    public PublicShopAdapter(Context context, Actions actions) {
        inflater = LayoutInflater.from(context);
        this.actions = actions;
    }

    public void setShops(List<PublicShopSnapshot> shops) { this.shops = new ArrayList<>(shops); notifyDataSetChanged(); }
    public void setBusy(boolean busy) { this.busy = busy; notifyDataSetChanged(); }
    @Override public int getCount() { return shops.size(); }
    @Override public PublicShopSnapshot getItem(int position) { return shops.get(position); }
    @Override public long getItemId(int position) { return position; }

    @Override public View getView(int position, View convertView, ViewGroup parent) {
        Holder holder;
        if (convertView == null) {
            convertView = inflater.inflate(R.layout.item_public_shop, parent, false);
            holder = new Holder(convertView);
            convertView.setTag(holder);
        } else holder = (Holder) convertView.getTag();
        PublicShopSnapshot shop = getItem(position);
        holder.name.setText(shop.name);
        holder.meta.setText(shop.products.size() + " 个公开商品 · " + dateFormat.format(new Date(shop.updatedAt)));
        holder.error.setVisibility(shop.lastError.isEmpty() ? View.GONE : View.VISIBLE);
        holder.error.setText(shop.lastError.isEmpty() ? "" : "上次刷新：" + shop.lastError);
        holder.refresh.setEnabled(!busy);
        holder.remove.setEnabled(!busy);
        holder.refresh.setOnClickListener(view -> actions.refresh(shop));
        holder.open.setOnClickListener(view -> actions.open(shop));
        holder.remove.setOnClickListener(view -> actions.remove(shop));
        return convertView;
    }

    private static final class Holder {
        final TextView name, meta, error;
        final Button refresh, open, remove;
        Holder(View view) {
            name = view.findViewById(R.id.shop_name);
            meta = view.findViewById(R.id.shop_meta);
            error = view.findViewById(R.id.shop_error);
            refresh = view.findViewById(R.id.shop_refresh);
            open = view.findViewById(R.id.shop_open);
            remove = view.findViewById(R.id.shop_remove);
        }
    }
}
