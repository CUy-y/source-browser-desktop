import type { ProductRecord } from "./types";

export type RelationHealthSeverity = "ok" | "info" | "warning" | "danger";

export interface RelationHealthItem {
  key: string;
  label: string;
  value: string;
  severity: RelationHealthSeverity;
}

export interface RelationHealthReport {
  score: number;
  items: RelationHealthItem[];
}

const money = (value: number | null): string => value === null ? "—" : `¥${value.toFixed(2).replace(/\.00$/, "")}`;

export function isValidRelationLink(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && (url.hostname === "pay.ldxp.cn" || url.hostname === "www.ldxp.cn") && url.pathname.startsWith("/item/");
  } catch {
    return false;
  }
}

export function evaluateRelationHealth(product: ProductRecord): RelationHealthReport {
  if (product.relation !== "connected") {
    return { score: 0, items: [{ key: "relation", label: "关联状态", value: "当前商品未关联", severity: "info" }] };
  }

  const details = product.relationDetails;
  const items: RelationHealthItem[] = [];
  items.push({
    key: "source-status",
    label: "货源状态",
    value: product.status === "normal" ? "正常" : `异常（${product.statusLabel}）`,
    severity: product.status === "normal" ? "ok" : "danger"
  });

  const margin = details.price !== null && product.costPrice !== null ? details.price - product.costPrice : null;
  items.push({
    key: "margin",
    label: "售价与成本差额",
    value: margin === null ? "字段缺失" : `${money(details.price)} − ${money(product.costPrice)} = ${money(margin)}`,
    severity: margin === null ? "info" : margin < 0 ? "danger" : margin === 0 ? "warning" : "ok"
  });

  const belowLimit = details.price !== null && product.agentPriceLimit !== null && product.agentPriceLimit > 0 && details.price < product.agentPriceLimit;
  items.push({
    key: "price-limit",
    label: "最低售价限制",
    value: product.agentPriceLimit === null || product.agentPriceLimit <= 0
      ? "平台未返回最低限制"
      : belowLimit
        ? `${money(details.price)} 低于 ${money(product.agentPriceLimit)}`
        : `${money(details.price)}，限制 ${money(product.agentPriceLimit)}`,
    severity: belowLimit ? "danger" : product.agentPriceLimit === null ? "info" : "ok"
  });

  const costIncrease = product.change?.costPriceDelta !== null && product.change?.costPriceDelta !== undefined && product.change.costPriceDelta > 0
    ? product.change.costPriceDelta
    : null;
  items.push({
    key: "cost-change",
    label: "成本变化",
    value: costIncrease === null ? "本次未发现成本上涨" : `较上次上涨 ${money(costIncrease)}`,
    severity: costIncrease === null ? "ok" : "warning"
  });

  items.push({
    key: "name-sync",
    label: "名称同步",
    value: details.nameSync === null ? "平台未返回" : details.nameSync ? "已开启" : "未开启",
    severity: details.nameSync === false ? "warning" : details.nameSync === null ? "info" : "ok"
  });
  items.push({
    key: "description-sync",
    label: "描述同步",
    value: details.descriptionSync === null ? "平台未返回" : details.descriptionSync ? "已开启" : "未开启",
    severity: details.descriptionSync === false ? "warning" : details.descriptionSync === null ? "info" : "ok"
  });
  items.push({
    key: "relation-link",
    label: "关联商品链接",
    value: details.link ? isValidRelationLink(details.link) ? "有效" : "格式异常" : "平台未返回",
    severity: details.link ? isValidRelationLink(details.link) ? "ok" : "danger" : "info"
  });

  const deductions = items.reduce((total, item) => total + (item.severity === "danger" ? 25 : item.severity === "warning" ? 10 : 0), 0);
  return { score: Math.max(0, 100 - deductions), items };
}
