"use client";

import { create } from "zustand";
import { nanoid } from "nanoid";

import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, resolveImageUrl } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { createPersonalAsset, editPersonalAssets, fetchPersonalAssets } from "@/services/api/personal-assets";
import { assetNeedsOriginalDevice, prepareAccountAsset, preserveGuestAsset } from "@/services/personal-asset-media";
import { useUserStore } from "@/stores/use-user-store";

export type AssetKind = "text" | "image" | "video" | "audio";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; bytes?: number; mimeType: string; durationMs?: number } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    category?: string;
    folder?: string;
    sku?: string;
    stage?: "original" | "candidate" | "final";
    source?: string;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string;
    metadata?: Record<string, unknown>;
};

type NewAsset<T extends Asset> = Omit<T, "id" | "createdAt" | "updatedAt" | "deletedAt">;
export type AssetInput = NewAsset<TextAsset> | NewAsset<ImageAsset> | NewAsset<VideoAsset> | NewAsset<AudioAsset>;
export type AssetPatch = Partial<AssetInput> & { trashed?: boolean; addTags?: string[] };

type AssetStore = {
    assets: Asset[];
    trash: Asset[];
    guestAssets: Asset[];
    loading: boolean;
    loadError: string;
    load: () => Promise<void>;
    allAssets: () => Asset[];
    addAsset: (asset: AssetInput, id?: string, copyMedia?: boolean) => Promise<string>;
    updateAssets: (ids: string[], patch: AssetPatch) => Promise<void>;
    updateAsset: (id: string, patch: AssetPatch) => Promise<void>;
    migrateAsset: (asset: Asset) => Promise<void>;
    cleanupImages: (extra?: unknown, storageKeys?: ReadonlyMap<string, string>, ownerToken?: string) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
let scopeToken = "";
let loadSequence = 0;
let loadingRequest: Promise<void> | undefined;
let guestPromise: Promise<Asset[]> | undefined;
let guestWrites: Promise<unknown> = Promise.resolve();

async function resolveStoredAsset(asset: Asset): Promise<Asset> {
    const base = { ...asset, tags: asset.tags || [], coverUrl: asset.coverUrl || "" };
    if (base.kind === "text" || !base.data.storageKey) return base;
    if (base.kind === "image") {
        const url = await resolveImageUrl(base.data.storageKey, base.data.dataUrl);
        return { ...base, coverUrl: base.coverUrl.startsWith("blob:") ? url : base.coverUrl, data: { ...base.data, dataUrl: url } };
    }
    const url = await resolveMediaUrl(base.data.storageKey, base.data.url);
    return base.kind === "video" ? { ...base, data: { ...base.data, url } } : { ...base, data: { ...base.data, url } };
}

function loadGuestAssets() {
    return guestPromise ||= Promise.resolve(localForageStorage.getItem(ASSET_STORE_KEY)).then(async (value) => {
        const data = value ? JSON.parse(value) as { state?: { assets?: Asset[] } } : null;
        return Promise.all((data?.state?.assets || []).map((asset) => resolveStoredAsset(asset).catch(() => asset)));
    }).catch((error) => {
        guestPromise = undefined;
        throw error;
    });
}

function visibleAssets(records: Asset[]) {
    return {
        assets: records.filter((asset) => !asset.deletedAt),
        trash: records.filter((asset) => Boolean(asset.deletedAt)),
    };
}

function currentToken() {
    const { token, user } = useUserStore.getState();
    return user ? token : "";
}

function checkSession(token: string) {
    if (currentToken() !== token) throw new Error("登录状态已变化，请重试");
}

export const useAssetStore = create<AssetStore>((set, get) => {
    const merge = (updates: Asset[]) => {
        const byID = new Map(updates.map((asset) => [asset.id, asset]));
        const previous = get().allAssets();
        const records = previous.map((asset) => {
            const next = byID.get(asset.id);
            byID.delete(asset.id);
            const previousTime = Date.parse(asset.updatedAt);
            return next && (!Number.isFinite(previousTime) || Date.parse(next.updatedAt) >= previousTime) ? next : asset;
        });
        records.unshift(...byID.values());
        records.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
        set(visibleAssets(records));
    };

    const updateGuest = (edit: (records: Asset[]) => Asset[], token: string) => {
        const write = guestWrites.catch(() => {}).then(async () => {
            const records = await loadGuestAssets();
            checkSession(token);
            const next = edit(records);
            await localForageStorage.setItem(ASSET_STORE_KEY, JSON.stringify({ state: { assets: next }, version: 0 }));
            guestPromise = Promise.resolve(next);
            if (currentToken() === token) set({ guestAssets: next, ...visibleAssets(next) });
        });
        guestWrites = write;
        return write;
    };

    return {
        assets: [],
        trash: [],
        guestAssets: [],
        loading: true,
        loadError: "",
        allAssets: () => [...get().assets, ...get().trash],
        load: () => {
            const token = currentToken();
            const sequence = ++loadSequence;
            const scopeChanged = token !== scopeToken;
            scopeToken = token;
            set({ loading: true, loadError: "", ...(scopeChanged ? { assets: [], trash: [] } : {}) });
            const request = (async () => {
                try {
                    const local = await (token ? loadGuestAssets().catch(() => []) : loadGuestAssets());
                    const data = token ? await fetchPersonalAssets(token) : local;
                    const records = token ? await Promise.all(data.map((asset) => resolveStoredAsset(asset).catch(() => asset))) : data;
                    if (currentToken() === token && sequence === loadSequence) set({ ...visibleAssets(records), guestAssets: local, loading: false });
                } catch (error) {
                    if (currentToken() === token && sequence === loadSequence) set({ loading: false, loadError: error instanceof Error ? error.message : "资产加载失败" });
                }
            })();
            loadingRequest = request;
            return request;
        },
        addAsset: async (input, id = nanoid(), copyMedia = false) => {
            const token = currentToken();
            const time = new Date().toISOString();
            const asset: Asset = { ...input, id, createdAt: time, updatedAt: time };
            await (scopeToken !== token ? get().load() : loadingRequest);
            checkSession(token);
            if (!token) {
                const ready = copyMedia ? await preserveGuestAsset(asset) : asset;
                await updateGuest((records) => [ready, ...records.filter((item) => item.id !== id)], token);
                return id;
            }
            const ready = await prepareAccountAsset(asset, token, copyMedia);
            checkSession(token);
            const saved = await createPersonalAsset(token, ready);
            if (currentToken() === token) {
                const refresh = get().loading || Boolean(get().loadError);
                ++loadSequence;
                merge([saved]);
                if (refresh) void get().load();
            }
            return saved.id;
        },
        updateAsset: (id, patch) => get().updateAssets([id], patch),
        updateAssets: async (ids, patch) => {
            const token = currentToken();
            await (scopeToken !== token ? get().load() : loadingRequest);
            checkSession(token);
            if (!token) {
                const { trashed, addTags, ...fields } = patch;
                const now = new Date().toISOString();
                await updateGuest((records) => records.map((asset) => ids.includes(asset.id) ?
                    { ...asset, ...fields, tags: addTags ? [...new Set([...(fields.tags || asset.tags || []), ...addTags])] : fields.tags || asset.tags, updatedAt: now, deletedAt: trashed === undefined ? asset.deletedAt : trashed ? asset.deletedAt || now : undefined } as Asset : asset), token);
                return;
            }
            if (patch.data && ids.length === 1) {
                const previous = get().allAssets().find((item) => item.id === ids[0]);
                if (previous) {
                    const updated = await prepareAccountAsset({ ...previous, ...patch } as Asset, token);
                    patch = { ...patch, data: updated.data, coverUrl: updated.coverUrl } as AssetPatch;
                }
            }
            checkSession(token);
            const saved = await editPersonalAssets(token, ids, patch);
            const resolved = await Promise.all(saved.map((asset) => resolveStoredAsset(asset).catch(() => asset)));
            if (currentToken() === token) {
                const refresh = get().loading || Boolean(get().loadError);
                ++loadSequence;
                merge(resolved);
                if (refresh) void get().load();
            }
        },
        migrateAsset: async (asset) => {
            const token = currentToken();
            if (!token) throw new Error("请先登录");
            const existing = get().allAssets().find((item) => item.id === asset.id);
            if (!existing) {
                await get().addAsset(asset, asset.id, assetNeedsOriginalDevice(asset));
            } else if (assetNeedsOriginalDevice(existing) && !existing.deletedAt) {
                const ready = await prepareAccountAsset(asset, token, true);
                await get().updateAsset(existing.id, { data: ready.data, coverUrl: ready.coverUrl } as AssetPatch);
            }
        },
            cleanupImages: (extra, storageKeys, ownerToken) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/app/(user)/canvas/stores/use-canvas-store");
                    const { loadLocalAgentSkills, useAgentSkillStore } = await import("@/stores/use-agent-skill-store");
                    const logKeys: string[] = [];
                    try {
                        const localforage = (await import("localforage")).default;
                        const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
                        await imageLogStore.iterate((log: any) => {
                            if (log) {
                                if (Array.isArray(log.images)) {
                                    log.images.forEach((img: any) => {
                                        if (img && img.storageKey) logKeys.push(img.storageKey);
                                    });
                                }
                                if (Array.isArray(log.references)) {
                                    log.references.forEach((ref: any) => {
                                        if (ref && ref.storageKey) logKeys.push(ref.storageKey);
                                    });
                                }
                            }
                        });
                        const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
                        await videoLogStore.iterate((log: any) => {
                            if (log) {
                                if (log.video && log.video.storageKey) {
                                    logKeys.push(log.video.storageKey);
                                }
                                if (Array.isArray(log.references)) {
                                    log.references.forEach((ref: any) => {
                                        if (ref && ref.storageKey) logKeys.push(ref.storageKey);
                                    });
                                }
                            }
                        });
                    } catch (e) {
                        console.error("Error gathering log keys in cleanupImages", e);
                    }

                    try {
                        await useAgentSkillStore.getState().loadSkills();
                        const skillStore = useAgentSkillStore.getState();
                        const localSkills = useUserStore.getState().token ? await loadLocalAgentSkills() : [];
                        await cleanupUnusedImages({ assets: get().allAssets(), projects: useCanvasStore.getState().projects, skills: [...skillStore.systemSkills, ...skillStore.userSkills, ...localSkills], extra, logKeys }, storageKeys, ownerToken);
                    } catch (error) {
                        console.error("Error gathering Skill keys in cleanupImages", error);
                    }
                    await cleanupUnusedMedia({ assets: get().allAssets(), projects: useCanvasStore.getState().projects, extra, logKeys });
                }, 0);
            },
    };
});

useUserStore.subscribe((state, previous) => {
    if (state.user?.id !== previous.user?.id) {
        ++loadSequence;
        useAssetStore.setState({ assets: [], trash: [], loading: true, loadError: "" });
    }
});
