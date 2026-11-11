import { apiGet, apiPost } from "@/services/api/request";
import type { UploadedFile } from "@/services/file-storage";
import type { Asset, AssetPatch } from "@/stores/use-asset-store";

const path = "/api/v1/personal-assets";

export type AssetReference = { id: string; name: string };

export const fetchPersonalAssets = (token: string) => apiGet<Asset[]>(path, undefined, token);
export const createPersonalAsset = (token: string, asset: Asset) => apiPost<Asset>(path, asset, token);
export const editPersonalAssets = (token: string, ids: string[], patch: AssetPatch) => apiPost<Asset[]>(path + "/edit", { ids, patch }, token);
export const fetchAssetReferences = (token: string, id: string) => apiGet<AssetReference[]>(path + "/references", { id }, token);

export function uploadPersonalAssetFile(token: string, blob: Blob, filename: string, progress?: (percent: number) => void) {
    return new Promise<UploadedFile>((resolve, reject) => {
        const form = new FormData();
        form.append("file", blob, filename);
        const request = new XMLHttpRequest();
        request.open("POST", path + "/files");
        request.setRequestHeader("Authorization", "Bearer " + token);
        request.responseType = "json";
        request.timeout = 300_000;
        request.upload.onprogress = ({ loaded, total }) => {
            if (total) progress?.(Math.min(99, Math.round(loaded / total * 100)));
        };
        request.onload = () => {
            const payload = request.response;
            if (request.status >= 200 && request.status < 300 && payload?.code === 0 && payload.data) {
                progress?.(100);
                resolve(payload.data);
            } else {
                reject(new Error(payload?.msg || (request.status === 413 ? "文件超过站点上传限制" : "文件上传失败")));
            }
        };
        request.onerror = request.ontimeout = () => reject(new Error("文件上传中断，请重试"));
        request.send(form);
    });
}
