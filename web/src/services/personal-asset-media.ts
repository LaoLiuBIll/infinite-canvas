"use client";

import { getMediaBlob, readVideoMeta, resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { getImageBlob, getProxyUrl, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { uploadPersonalAssetFile } from "@/services/api/personal-assets";
import type { Asset, AssetInput } from "@/stores/use-asset-store";

export const assetStages = [
    { value: "original", label: "原始素材" },
    { value: "candidate", label: "候选" },
    { value: "final", label: "成品" },
] as const;

export const assetKinds = [
    { value: "image", label: "图片" },
    { value: "video", label: "视频" },
    { value: "audio", label: "音频" },
    { value: "text", label: "文本" },
] as const;

export function assetMediaUrl(asset: Asset | AssetInput) {
    return asset.kind === "text" ? "" : asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
}

export async function readAssetMedia(asset: Asset | AssetInput, token = "") {
    if (asset.kind === "text") return new Blob([asset.data.content], { type: "text/plain;charset=utf-8" });
    const key = asset.data.storageKey;
    const local = key ? await (asset.kind === "image" ? getImageBlob(key) : getMediaBlob(key)).catch(() => null) : null;
    if (local) return local;
    const fallback = assetMediaUrl(asset);
    const url = (await (asset.kind === "image" ? resolveImageUrl(key, fallback) : resolveMediaUrl(key, fallback))) || fallback;
    if (!url) throw new Error("找不到原文件");
    const target = new URL(url, window.location.origin);
    const response = await fetch(getProxyUrl(url), {
        headers: token && target.origin === window.location.origin && target.pathname.startsWith("/api/v1/") ? { Authorization: "Bearer " + token } : undefined,
    }).catch(() => { throw new Error("原文件下载失败，请检查链接是否仍有效"); });
    if (!response.ok) throw new Error("原文件无法读取");
    const blob = await response.blob();
    if (!blob.size || blob.type.includes("json") || blob.type.includes("text/html")) throw new Error("原文件无法读取");
    return blob;
}

export async function prepareAccountAsset(asset: Asset, token: string, force = false): Promise<Asset> {
    if (asset.kind === "text") return asset;
    const oldUrl = assetMediaUrl(asset);
    const key = asset.data.storageKey;
    if (key?.startsWith("server:") && !key.startsWith("server:webdav:")) {
        if (oldUrl.startsWith("blob:")) {
            const url = "/api/files/" + encodeURIComponent(key.slice(7)) + "/content";
            return replaceAssetFile(asset, url, key, asset.data.mimeType, asset.data.bytes, oldUrl);
        }
        return asset;
    }
    if (!force && !key && !/^(blob:|data:|\/api\/v1\/)/.test(oldUrl)) return asset;
    const blob = await readAssetMedia(asset, token);
    const file = await uploadPersonalAssetFile(token, blob, asset.title);
    return replaceAssetFile(asset, file.url, file.storageKey, file.mimeType, file.bytes, oldUrl);
}

function replaceAssetFile(asset: Exclude<Asset, { kind: "text" }>, url: string, storageKey: string, mimeType: string, bytes: number | undefined, oldUrl: string): Asset {
    const coverUrl = asset.coverUrl === oldUrl || asset.coverUrl?.startsWith("blob:") ? (asset.kind === "image" ? url : "") : asset.coverUrl;
    if (asset.kind === "image") return { ...asset, coverUrl: coverUrl || url, data: { ...asset.data, dataUrl: url, storageKey, mimeType, bytes: bytes || 0 } };
    if (asset.kind === "video") return { ...asset, coverUrl, data: { ...asset.data, url, storageKey, mimeType, bytes: bytes || 0 } };
    return { ...asset, coverUrl, data: { ...asset.data, url, storageKey, mimeType, bytes } };
}

export async function preserveGuestAsset(asset: Asset): Promise<Asset> {
    if (asset.kind === "text" || asset.data.storageKey) return asset;
    const blob = await readAssetMedia(asset);
    const saved = asset.kind === "image" ? await uploadImage(blob, { localOnly: true }) : await uploadMediaFile(blob, "file");
    return replaceAssetFile(asset, saved.url, saved.storageKey, saved.mimeType, saved.bytes, assetMediaUrl(asset));
}

export async function assetFromFile(file: File, token: string, onProgress?: (value: number) => void): Promise<AssetInput> {
    if (file.size > 256_000_000) throw new Error("单个文件不能超过 256 MB");
    const kind = file.type.split("/")[0];
    const base = { title: file.name, coverUrl: "", tags: [], source: "本地上传", stage: "original" as const };
    if (kind !== "image" && kind !== "video" && kind !== "audio") throw new Error("请选择图片、视频或音频文件");
    if (!token && kind === "image") {
        const stored = await uploadImage(file);
        return { ...base, kind, coverUrl: stored.url, data: { ...stored, dataUrl: stored.url } };
    }
    const stored = token ? await uploadPersonalAssetFile(token, file, file.name, onProgress) : await uploadMediaFile(file, "file");
    if (kind === "audio") {
        const preview = URL.createObjectURL(file);
        try {
            const durationMs = await new Promise<number | undefined>((resolve) => {
                const audio = document.createElement("audio");
                const finish = () => {
                    window.clearTimeout(timeout);
                    resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined);
                };
                const timeout = window.setTimeout(finish, 3000);
                audio.onloadedmetadata = audio.onerror = finish;
                audio.preload = "metadata";
                audio.src = preview;
            });
            return { ...base, kind, data: { ...stored, durationMs } };
        } finally {
            URL.revokeObjectURL(preview);
        }
    }
    if (kind === "image") {
        const bitmap = await createImageBitmap(file).catch(() => null);
        const data = { ...stored, dataUrl: stored.url, width: bitmap?.width || 0, height: bitmap?.height || 0 };
        bitmap?.close();
        return { ...base, kind, coverUrl: stored.url, data };
    }
    const preview = URL.createObjectURL(file);
    try {
        const meta = await readVideoMeta(preview);
        return { ...base, kind, data: { ...stored, width: meta.width || 0, height: meta.height || 0 } };
    } finally {
        URL.revokeObjectURL(preview);
    }
}

export function isAssetRecoverable(asset: Asset) {
    return Boolean(asset.deletedAt && Date.parse(asset.deletedAt) >= Date.now() - 30 * 24 * 60 * 60 * 1000);
}

export function assetSearchText(asset: Asset) {
    return [asset.title, asset.sku, asset.folder, asset.category, asset.source, ...(asset.tags || []), asset.kind === "text" ? asset.data.content : ""].join(" ").toLowerCase();
}

export function assetNeedsOriginalDevice(asset: Asset) {
    if (asset.kind === "text") return false;
    const key = asset.data.storageKey;
    return Boolean((key && !key.startsWith("server:")) || assetMediaUrl(asset).startsWith("blob:"));
}
