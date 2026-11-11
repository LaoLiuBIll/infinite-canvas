import { saveAs } from "file-saver";

import { createZip, readZip } from "@/lib/zip";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { readAssetMedia } from "@/services/personal-asset-media";
import { nanoid } from "nanoid";
import type { Asset } from "@/stores/use-asset-store";

type AssetExportFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    assets: Asset[];
    files: AssetExportItem[];
};

type AssetExportItem = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

export async function exportAssets(assets: Asset[], token = "") {
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];
    const exported: Asset[] = [];
    for (const asset of assets) {
        if (asset.kind === "text") {
            exported.push(asset);
            zipFiles.push({ name: `files/${safeFileName(asset.title)}-${asset.id.slice(0, 8)}.txt`, data: asset.data.content });
            continue;
        }
        let blob: Blob;
        try {
            blob = await readAssetMedia(asset, token);
        } catch {
            throw new Error(`无法下载「${asset.title}」的原文件，请检查存储状态后重试`);
        }
        const storageKey = (asset.kind === "image" ? "image:" : "file:") + nanoid();
        const name = safeFileName(asset.title);
        const extension = /\.[a-z0-9]{2,5}$/i.test(name) ? "" : "." + fileExtension(blob.type, asset.kind);
        const path = `files/${asset.id.slice(0, 8)}-${name}${extension}`;
        files.push({ storageKey, path, mimeType: blob.type || asset.data.mimeType, bytes: blob.size });
        zipFiles.push({ name: path, data: blob });
        const data = asset.kind === "image" ? { ...asset.data, storageKey, dataUrl: "" } : { ...asset.data, storageKey, url: "" };
        exported.push({ ...asset, coverUrl: asset.kind === "image" ? "" : asset.coverUrl, data } as Asset);
    }
    const data: AssetExportFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), assets: exported, files };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    const sku = assets[0]?.sku;
    saveAs(zip, sku && assets.every((asset) => asset.sku === sku) ? safeFileName(sku) + "-素材.zip" : "资产中心.zip");
}

export async function readAssetPackage(file: File) {
    const zip = await readZip(file);
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("压缩包缺少资产清单");
    const data = JSON.parse(await assetFile.text()) as AssetExportFile;
    if (data.app !== "infinite-canvas" || data.version !== 1 || !Array.isArray(data.assets) || !Array.isArray(data.files)) throw new Error("资产压缩包格式无效");
    const localFiles = new Map<string, { key: string; url: string }>();
    for (const item of data.files) {
        const blob = zip.get(item.path);
        if (!blob) throw new Error("压缩包缺少原文件");
        const typed = blob.slice(0, blob.size, item.mimeType);
        const image = item.storageKey.startsWith("image:") || item.mimeType.startsWith("image/");
        const key = (image ? "image:" : "file:") + nanoid();
        const url = await (image ? setImageBlob(key, typed) : setMediaBlob(key, typed));
        localFiles.set(item.storageKey, { key, url });
    }
    return data.assets.map((asset): Asset => {
        if (asset.kind === "text" || !asset.data.storageKey) return asset;
        const local = localFiles.get(asset.data.storageKey);
        if (!local) return asset;
        if (asset.kind === "image") return { ...asset, coverUrl: local.url, data: { ...asset.data, dataUrl: local.url, storageKey: local.key } };
        return { ...asset, data: { ...asset.data, url: local.url, storageKey: local.key } } as Asset;
    });
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, kind: Asset["kind"]) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType === "video/mp4") return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("mpeg")) return "mp3";
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("flac")) return "flac";
    if (mimeType === "audio/mp4") return "m4a";
    if (mimeType.includes("wav")) return "wav";
    return kind === "image" ? "png" : "bin";
}
