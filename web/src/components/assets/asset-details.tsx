"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { formatBytes } from "@/lib/image-utils";
import { fetchAssetReferences, type AssetReference } from "@/services/api/personal-assets";
import { assetKinds, assetMediaUrl, assetStages } from "@/services/personal-asset-media";
import type { Asset } from "@/stores/use-asset-store";

export function AssetDetails({ asset, token }: { asset: Asset; token: string }) {
    const [refs, setRefs] = useState<AssetReference[]>([]);
    const [refError, setRefError] = useState(false);
    const [checkingRefs, setCheckingRefs] = useState(Boolean(token));
    const [mediaError, setMediaError] = useState(false);
    const url = assetMediaUrl(asset);
    useEffect(() => {
        let active = true;
        if (token) fetchAssetReferences(token, asset.id).then((items) => { if (active) setRefs(items); }).catch(() => { if (active) setRefError(true); }).finally(() => { if (active) setCheckingRefs(false); });
        return () => { active = false; };
    }, [asset.id, token]);
    useEffect(() => setMediaError(false), [url]);
    const data = asset.kind === "text" ? null : asset.data;
    return (
        <div className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-border bg-muted p-2">
                {asset.kind === "text" && <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-2 text-sm">{asset.data.content}</pre>}
                {asset.kind === "image" && url && <img alt={asset.title} className="mx-auto max-h-72 object-contain" src={url} onError={() => setMediaError(true)} />}
                {asset.kind === "video" && url && <video aria-label={asset.title} className="w-full" src={url} controls preload="metadata" onError={() => setMediaError(true)} />}
                {asset.kind === "audio" && url && <audio aria-label={asset.title} className="w-full" src={url} controls preload="metadata" onError={() => setMediaError(true)} />}
                {(mediaError || (data && !url)) && <p className="p-2 text-sm text-destructive">原文件暂不可读。旧本地素材可在原设备补传。</p>}
            </div>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
                {[
                    ["类型", assetKinds.find((item) => item.value === asset.kind)?.label],
                    ["分类", asset.category || "未分类"], ["款号", asset.sku], ["文件夹", asset.folder ?? asset.category],
                    ["用途", assetStages.find((item) => item.value === asset.stage)?.label],
                    ["来源", asset.source], ["标签", asset.tags?.join("、")], ["入库时间", new Date(asset.createdAt).toLocaleDateString("zh-CN")],
                    ["文件大小", data?.bytes ? formatBytes(data.bytes) : ""],
                    ["尺寸", data && "width" in data && data.width ? `${data.width} × ${data.height}` : ""],
                    ["时长", data && "durationMs" in data && data.durationMs ? `${(data.durationMs / 1000).toFixed(1)} 秒` : ""],
                    ["参考素材", Array.isArray(asset.metadata?.references) ? asset.metadata.references.filter((value) => typeof value === "string").join("、") : ""],
                    ["模型", typeof asset.metadata?.model === "string" ? asset.metadata.model : ""],
                    ["提示词或文案", typeof asset.metadata?.prompt === "string" ? asset.metadata.prompt : ""],
                ].filter(([, value]) => value).map(([label, value]) => <div className="contents" key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>)}
            </dl>
            {token && <section className="border-t border-border pt-3">
                <h2 className="mb-2 font-medium">关联画布</h2>
                {refs.length ? <ul>{refs.map((ref) => <li key={ref.id}><Link className="text-primary underline" href={`/canvas/${encodeURIComponent(ref.id)}`}>{ref.name || ref.id}</Link></li>)}</ul>
                    : <p className="text-sm text-muted-foreground">{checkingRefs ? "正在检查画布引用…" : refError ? "未能读取画布引用" : "暂无画布引用"}</p>}
            </section>}
        </div>
    );
}
