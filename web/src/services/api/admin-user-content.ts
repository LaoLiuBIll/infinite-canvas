import { apiGet, compactApiParams } from "@/services/api/request";

export type ContentSection = "files" | "results" | "assets";
export type ContentRole = "admin" | "user";

export type AdminContentRecord = {
    id: string;
    userId: string;
    username: string;
    displayName: string;
    role: ContentRole;
    source: string;
    title: string;
    kind: string;
    status?: string;
    model?: string;
    createdAt: string;
    bytes?: number;
};

export type AdminContentDetail = AdminContentRecord & {
    text?: string;
    prompt?: string;
    category?: string;
    folder?: string;
    sku?: string;
    tags?: string[];
    media?: string[];
};

type ContentQuery = {
    section: ContentSection;
    userId?: string;
    role?: ContentRole;
    type?: string;
    keyword?: string;
    page: number;
    pageSize: number;
};

const path = "/api/admin/user-content";

export const fetchAdminContent = (token: string, query: ContentQuery) =>
    apiGet<{ items: AdminContentRecord[]; total: number }>(path, compactApiParams(query), token);

export const fetchAdminContentDetail = (token: string, item: AdminContentRecord) =>
    apiGet<AdminContentDetail>(path + "/detail", { source: item.source, userId: item.userId, id: item.id }, token);

export async function fetchAdminContentMedia(token: string, url: string, signal: AbortSignal) {
    if (!url.startsWith(path + "/media?")) throw new Error("媒体预览地址无效");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.msg || "媒体无法预览");
    }
    const blob = await response.blob();
    if (blob.size > 128 * 1024 * 1024) throw new Error("媒体过大，无法在线预览");
    return blob;
}
