"use client";

import { create } from "zustand";
import { nanoid } from "nanoid";

import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, resolveImageUrl } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { createPersonalAsset, deleteAssetCategory, editPersonalAssets, fetchAssetCatalog, saveAssetCategory } from "@/services/api/personal-assets";
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
export type AssetInput = (NewAsset<TextAsset> | NewAsset<ImageAsset> | NewAsset<VideoAsset> | NewAsset<AudioAsset>) & { categoryId?: string };
export type AssetPatch = Partial<AssetInput> & { trashed?: boolean; addTags?: string[] };

export type AssetCategory = { id: string; name: string };

type GuestAssetData = { assets: Asset[]; categories: AssetCategory[] };

export function categoryKey(name?: string) {
    const key = name?.trim().toLowerCase();
    return key && key !== "未分类" ? key : "";
}

type AssetStore = {
    assets: Asset[];
    trash: Asset[];
    guestAssets: Asset[];
    categories: AssetCategory[];
    loading: boolean;
    loadError: string;
    load: () => Promise<void>;
    allAssets: () => Asset[];
    addAsset: (asset: AssetInput, id?: string, copyMedia?: boolean) => Promise<string>;
    updateAssets: (ids: string[], patch: AssetPatch) => Promise<void>;
    updateAsset: (id: string, patch: AssetPatch) => Promise<void>;
    migrateAsset: (asset: Asset) => Promise<void>;
    saveCategory: (name: string, id?: string) => Promise<void>;
    deleteCategory: (id: string) => Promise<void>;
    cleanupImages: (extra?: unknown, storageKeys?: ReadonlyMap<string, string>, ownerToken?: string) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
let scopeToken = "";
let loadSequence = 0;
let loadingRequest: Promise<void> | undefined;
let guestPromise: Promise<GuestAssetData> | undefined;
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

function withGuestCategories(data: GuestAssetData): GuestAssetData {
    const categories = new Map(data.categories.map((category) => [categoryKey(category.name), category]));
    for (const asset of data.assets) {
        const name = asset.category?.trim();
        if (name && name !== "未分类" && !categories.has(categoryKey(name))) {
            categories.set(categoryKey(name), { id: nanoid(), name });
        }
    }
    return { ...data, categories: [...categories.values()] };
}

function loadGuestAssets() {
    return guestPromise ||= Promise.resolve(localForageStorage.getItem(ASSET_STORE_KEY)).then(async (value) => {
        const data = value ? JSON.parse(value) as { state?: Partial<GuestAssetData> } : null;
        const assets = await Promise.all((data?.state?.assets || []).map((asset) => resolveStoredAsset(asset).catch(() => asset)));
        return withGuestCategories({ assets, categories: data?.state?.categories || [] });
    }).catch((error) => {
        guestPromise = undefined;
        throw error;
    });
}

function selectedCategoryName(categories: AssetCategory[], id: string) {
    if (!id) return "";
    const category = categories.find((item) => item.id === id);
    if (!category) throw new Error("分类已删除，请刷新后重试");
    return category.name;
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

    const updateGuest = (edit: (data: GuestAssetData) => GuestAssetData, token: string) => {
        const write = guestWrites.catch(() => {}).then(async () => {
            const current = await loadGuestAssets();
            checkSession(token);
            const next = withGuestCategories(edit(current));
            await localForageStorage.setItem(ASSET_STORE_KEY, JSON.stringify({ state: next, version: 0 }));
            guestPromise = Promise.resolve(next);
            if (currentToken() === token) set({ guestAssets: next.assets, categories: next.categories, ...visibleAssets(next.assets) });
        });
        guestWrites = write;
        return write;
    };

    const changeCategory = async (name: string, id?: string, removing = false) => {
        const token = currentToken();
        await (scopeToken !== token ? get().load() : loadingRequest);
        checkSession(token);
        if (!token) {
            await updateGuest((data) => {
                const existing = data.categories.find((category) => category.id === id);
                if (id && !existing) throw new Error("分类不存在，请刷新后重试");
                if (!removing && data.categories.some((category) => category.id !== id && categoryKey(category.name) === categoryKey(name))) {
                    throw new Error("分类名称已存在");
                }
                const categories = removing ? data.categories.filter((category) => category.id !== id) :
                    existing ? data.categories.map((category) => category.id === id ? { ...category, name } : category) :
                    [...data.categories, { id: nanoid(), name }];
                const updatedAt = new Date().toISOString();
                const assets = existing ? data.assets.map((asset) => categoryKey(asset.category) === categoryKey(existing.name) ?
                    { ...asset, category: name, folder: asset.folder ?? asset.category, updatedAt } : asset) : data.assets;
                return { categories, assets };
            }, token);
            return;
        }
        const result = removing && id ? await deleteAssetCategory(token, id) : await saveAssetCategory(token, name, id);
        const assets = await Promise.all(result.assets.map((asset) => resolveStoredAsset(asset).catch(() => asset)));
        checkSession(token);
        const refresh = get().loading || Boolean(get().loadError);
        ++loadSequence;
        merge(assets);
        set({ categories: result.categories });
        if (refresh) void get().load();
    };

    return {
        assets: [],
        trash: [],
        guestAssets: [],
        categories: [],
        loading: true,
        loadError: "",
        allAssets: () => [...get().assets, ...get().trash],
        load: () => {
            const token = currentToken();
            const sequence = ++loadSequence;
            const scopeChanged = token !== scopeToken;
            scopeToken = token;
            set({ loading: true, loadError: "", ...(scopeChanged ? { assets: [], trash: [], categories: [] } : {}) });
            const request = (async () => {
                try {
                    const local = await (token ? loadGuestAssets().catch(() => ({ assets: [], categories: [] })) : loadGuestAssets());
                    const { assets: data, categories } = token ? await fetchAssetCatalog(token) : local;
                    const records = token ? await Promise.all(data.map((asset) => resolveStoredAsset(asset).catch(() => asset))) : data;
                    if (currentToken() === token && sequence === loadSequence) set({ ...visibleAssets(records), categories, guestAssets: local.assets, loading: false });
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
            const { categoryId, ...fields } = input;
            const asset: Asset = { ...fields, id, createdAt: time, updatedAt: time };
            await (scopeToken !== token ? get().load() : loadingRequest);
            checkSession(token);
            if (!token) {
                const ready = copyMedia ? await preserveGuestAsset(asset) : asset;
                await updateGuest((data) => {
                    const category = categoryId === undefined ? ready.category : selectedCategoryName(data.categories, categoryId);
                    return { ...data, assets: [{ ...ready, category }, ...data.assets.filter((item) => item.id !== id)] };
                }, token);
                return id;
            }
            const ready = await prepareAccountAsset(asset, token, copyMedia);
            checkSession(token);
            const saved = await createPersonalAsset(token, { ...ready, categoryId });
            if (currentToken() === token) {
                const refresh = get().loading || Boolean(get().loadError);
                ++loadSequence;
                merge([saved]);
                if (refresh || (saved.category && !get().categories.some((category) => categoryKey(category.name) === categoryKey(saved.category)))) void get().load();
            }
            return saved.id;
        },
        updateAsset: (id, patch) => get().updateAssets([id], patch),
        updateAssets: async (ids, patch) => {
            const token = currentToken();
            await (scopeToken !== token ? get().load() : loadingRequest);
            checkSession(token);
            if (!token) {
                const { trashed, addTags, categoryId, ...fields } = patch;
                const now = new Date().toISOString();
                await updateGuest((data) => {
                    const assignment = categoryId === undefined ? {} : { category: selectedCategoryName(data.categories, categoryId) };
                    return { ...data, assets: data.assets.map((asset) => ids.includes(asset.id) ?
                        { ...asset, ...fields, ...assignment, tags: addTags ? [...new Set([...(fields.tags || asset.tags || []), ...addTags])] : fields.tags || asset.tags, updatedAt: now, deletedAt: trashed === undefined ? asset.deletedAt : trashed ? asset.deletedAt || now : undefined } as Asset : asset) };
                }, token);
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
        saveCategory: async (name, id) => {
            const trimmed = name.trim();
            if (!trimmed || trimmed === "未分类" || [...trimmed].length > 100 || /[\r\n\t]/.test(trimmed)) {
                throw new Error("请输入 1–100 字的分类名称。「未分类」是系统选项");
            }
            await changeCategory(trimmed, id);
        },
        deleteCategory: (id) => changeCategory("", id, true),
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
        useAssetStore.setState({ assets: [], trash: [], categories: [], loading: true, loadError: "" });
    }
});
