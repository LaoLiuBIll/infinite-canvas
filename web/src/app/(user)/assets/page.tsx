"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Drawer, Empty, Input, Modal, Pagination, Progress, Segmented, Select, Spin, Tag } from "antd";
import { AudioLines, Download, FileText, Film, FolderOpen, LayoutGrid, List, Plus, RotateCcw, Search, Settings2, Trash2, Upload } from "lucide-react";
import { saveAs } from "file-saver";
import { nanoid } from "nanoid";

import { AssetDetails } from "@/components/assets/asset-details";
import { AssetFormModal } from "@/components/assets/asset-form-modal";
import { assetFromFile, assetKinds, assetNeedsOriginalDevice, assetSearchText, assetStages, isAssetRecoverable, readAssetMedia } from "@/services/personal-asset-media";
import { categoryKey, useAssetStore, type Asset, type AssetInput, type AssetPatch } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";

type UploadItem = { id: string; file: File; progress: number; asset?: AssetInput; done?: boolean; error?: string };
const PAGE_SIZE = 24;

const valuesOf = (items: (string | undefined)[]) => [...new Set(items.filter((item): item is string => Boolean(item)))].sort().map((value) => ({ value, label: value }));
const errorText = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试";
const folderOf = (asset: Asset) => asset.folder ?? asset.category ?? "";
const dateText = (value: string) => new Date(value).toLocaleDateString("zh-CN");
const kindText = (asset: Asset) => assetKinds.find((item) => item.value === asset.kind)?.label;
const stageText = (asset: Asset) => assetStages.find((item) => item.value === asset.stage)?.label;

export default function AssetsPage() {
    const { message, modal } = App.useApp();
    const token = useUserStore((state) => state.user ? state.token : "");
    const assets = useAssetStore((state) => state.assets);
    const deleted = useAssetStore((state) => state.trash);
    const trash = useMemo(() => deleted.filter(isAssetRecoverable), [deleted]);
    const categories = useAssetStore((state) => state.categories);
    const loading = useAssetStore((state) => state.loading);
    const loadError = useAssetStore((state) => state.loadError);
    const guestAssets = useAssetStore((state) => state.guestAssets);
    const [view, setView] = useState<"active" | "trash">("active");
    const [layout, setLayout] = useState<"grid" | "list">("grid");
    const [keyword, setKeyword] = useState("");
    const [kind, setKind] = useState<string>();
    const [sku, setSKU] = useState<string>();
    const [categoryID, setCategoryID] = useState<string>();
    const selectedCategory = categories.find((item) => item.id === categoryID);
    const [folder, setFolder] = useState<string>();
    const [source, setSource] = useState<string>();
    const [tags, setTags] = useState<string[]>([]);
    const [stage, setStage] = useState<string>();
    const [period, setPeriod] = useState<number>();
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState<string[]>([]);
    const [detail, setDetail] = useState<Asset | null>(null);
    const [editing, setEditing] = useState<Asset | null>();
    const [batch, setBatch] = useState<AssetPatch | null>(null);
    const [savingBatch, setSavingBatch] = useState(false);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploads, setUploads] = useState<UploadItem[]>([]);
    const [uploadFields, setUploadFields] = useState({ sku: "", folder: "", tags: [] as string[] });
    const [busy, setBusy] = useState(false);
    const filesRef = useRef<HTMLInputElement>(null);
    const zipRef = useRef<HTMLInputElement>(null);
    const rows = view === "trash" ? trash : assets;
    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        const cutoff = period ? Date.now() - period * 86_400_000 : 0;
        return rows.filter((asset) =>
            (!query || assetSearchText(asset).includes(query)) && (!kind || asset.kind === kind) &&
            (!sku || asset.sku === sku) && (!folder || folderOf(asset) === folder) &&
            (categoryID === "" ? !categoryKey(asset.category) : !selectedCategory || categoryKey(asset.category) === categoryKey(selectedCategory.name)) &&
            (!source || asset.source === source) && (!stage || asset.stage === stage) &&
            tags.every((tag) => asset.tags?.includes(tag)) && (!cutoff || Date.parse(asset.createdAt) >= cutoff));
    }, [rows, keyword, kind, sku, folder, source, stage, tags, period, categoryID, selectedCategory]);
    const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const visible = filtered.slice((Math.min(page, maxPage) - 1) * PAGE_SIZE, Math.min(page, maxPage) * PAGE_SIZE);
    const chosen = filtered.filter((asset) => selected.includes(asset.id));
    const activeDetail = detail && (rows.find((asset) => asset.id === detail.id) || detail);
    const known = new Set([...assets, ...deleted].map((asset) => asset.id));
    const localOnly = guestAssets.filter((asset) => !asset.deletedAt && !known.has(asset.id));
    const folders = valuesOf(assets.map(folderOf));

    useEffect(() => {
        setPage(1);
        setSelected([]);
    }, [view, keyword, kind, sku, folder, source, stage, tags, period, categoryID]);

    const changeSelection = (id: string, checked: boolean) => setSelected((items) => checked ? [...new Set([...items, id])] : items.filter((item) => item !== id));

    const download = async (items: Asset[], zip = true) => {
        setBusy(true);
        try {
            if (zip) await exportAssets(items, token);
            else {
                const asset = items[0];
                const blob = await readAssetMedia(asset, token);
                const extension = asset.kind === "text" ? "txt" : blob.type.split("/")[1]?.split(";")[0]?.replace(/^mpeg$/, "mp3").replace(/^jpeg$/, "jpg");
                saveAs(blob, extension && !/\.[a-z0-9]{2,5}$/i.test(asset.title) ? asset.title + "." + extension : asset.title);
            }
        } catch (error) {
            message.error(errorText(error));
        } finally {
            setBusy(false);
        }
    };

    const changeTrash = (items: Asset[], trashed: boolean) => {
        const apply = async () => {
            try {
                await useAssetStore.getState().updateAssets(items.map((item) => item.id), { trashed });
                setSelected([]);
                setDetail(null);
                message.success(trashed ? "已移入回收站" : "已恢复资产");
            } catch (error) {
                message.error(errorText(error));
            }
        };
        if (trashed) modal.confirm({
            title: `将 ${items.length} 项资产移入回收站？`,
            content: "30 天内可恢复，已引用的画布仍可使用原文件。",
            okText: "移入回收站",
            cancelText: "取消",
            onOk: apply,
        });
        else void apply();
    };

    const importZip = async (file?: File) => {
        if (!file) return;
        setBusy(true);
        try {
            const imported = await readAssetPackage(file);
            for (const asset of imported) await useAssetStore.getState().addAsset(asset);
            message.success(`已导入 ${imported.length} 项资产`);
        } catch (error) {
            message.error(errorText(error));
        } finally {
            setBusy(false);
            if (zipRef.current) zipRef.current.value = "";
        }
    };

    const migrate = async (items: Asset[]) => {
        setBusy(true);
        let saved = 0;
        const failed: string[] = [];
        try {
            for (const asset of items) {
                try {
                    await useAssetStore.getState().migrateAsset(asset);
                    saved++;
                } catch {
                    failed.push(asset.title);
                }
            }
            if (failed.length) message.warning(`已迁移 ${saved} 项，${failed.length} 项原文件不可读取或上传失败`);
            else message.success(`已迁移 ${saved} 项到账号`);
        } finally {
            setBusy(false);
        }
    };

    const queueFiles = (files: FileList | null) => {
        if (!files || uploading) return;
        setUploads((items) => [...items, ...Array.from(files, (file) => ({ id: nanoid(), file, progress: 0 }))]);
    };

    const uploadQueued = async () => {
        const pending = uploads.filter((item) => !item.done);
        setUploading(true);
        let succeeded = 0;
        const change = (id: string, patch: Partial<UploadItem>) => setUploads((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
        try {
            for (const item of pending) {
                change(item.id, { error: "", progress: 0 });
                try {
                    const asset = item.asset || await assetFromFile(item.file, token, (progress) => change(item.id, { progress: Math.min(99, progress) }));
                    change(item.id, { asset, progress: 99 });
                    if (useUserStore.getState().token !== token) throw new Error("登录状态已变化，请重新打开上传窗口");
                    await useAssetStore.getState().addAsset({ ...asset, sku: uploadFields.sku.trim(), folder: uploadFields.folder.trim(), tags: uploadFields.tags }, item.id);
                    change(item.id, { progress: 100, done: true });
                    succeeded++;
                } catch (error) {
                    change(item.id, { error: errorText(error) });
                }
            }
            if (succeeded) message.success(`已上传 ${succeeded} 项资产`);
        } finally {
            setUploading(false);
        }
    };

    const applyBatch = async () => {
        if (!batch || !Object.keys(batch).length) return;
        setSavingBatch(true);
        try {
            const { tags: addedTags, ...fields } = batch;
            const patch: AssetPatch = {
                ...fields,
                ...(fields.sku !== undefined ? { sku: fields.sku.trim() } : {}),
                ...(fields.folder !== undefined ? { folder: fields.folder.trim() } : {}),
                ...(addedTags?.length ? { addTags: addedTags } : {}),
            };
            if (!Object.keys(patch).length) {
                message.info("请填写要修改的内容");
                return;
            }
            await useAssetStore.getState().updateAssets(chosen.map((asset) => asset.id), patch);
            setBatch(null);
            setSelected([]);
            message.success("已更新所选资产");
        } catch (error) {
            message.error(errorText(error));
        } finally {
            setSavingBatch(false);
        }
    };

    return (
        <main className="h-full overflow-auto bg-background text-foreground">
            <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
                    <div>
                        <h1 className="text-2xl font-semibold">资产中心</h1>
                        <p className="mt-1 text-sm text-muted-foreground">{token ? "按款号管理素材，在画布和工作台中复用。" : "当前素材保存在此浏览器。登录后可保存到账号并跨设备使用。"}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button href="/assets/manage" icon={<Settings2 size={15} />}>资产管理</Button>
                        <Button href="/asset-library">公共素材库</Button>
                        <Button loading={busy} onClick={() => zipRef.current?.click()}>导入 ZIP</Button>
                        <Button icon={<Plus size={15} />} onClick={() => setEditing(null)}>新增单项</Button>
                        <Button type="primary" icon={<Upload size={15} />} onClick={() => { setUploads([]); setUploadFields({ sku: sku || "", folder: folder || "", tags: [] }); setUploadOpen(true); }}>批量上传</Button>
                        <input ref={zipRef} type="file" accept=".zip" hidden onChange={(event) => void importZip(event.target.files?.[0])} />
                    </div>
                </header>

                {loadError && <Alert className="mt-4" type="error" showIcon title={loadError} action={<Button size="small" onClick={() => void useAssetStore.getState().load()}>重试</Button>} />}
                {token && localOnly.length > 0 && <Alert className="mt-4" type="info" showIcon title={`此浏览器有 ${localOnly.length} 项本地素材`} action={<Button size="small" loading={busy} onClick={() => modal.confirm({ title: "将此浏览器的本地素材保存到当前账号？", okText: "迁移", cancelText: "取消", onOk: () => migrate(localOnly) })}>迁移到账号</Button>} />}

                <div className="my-4 flex flex-wrap items-center justify-between gap-2">
                    <Segmented<"active" | "trash"> value={view} onChange={(value) => { setView(value); setDetail(null); }} options={[{ label: `全部资产 ${assets.length}`, value: "active" }, { label: `回收站 ${trash.length}`, value: "trash" }]} />
                    <Segmented value={layout} onChange={setLayout} options={[{ label: <span aria-label="网格视图"><LayoutGrid size={16} /></span>, value: "grid" }, { label: <span aria-label="列表视图"><List size={16} /></span>, value: "list" }]} />
                </div>
                <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-3">
                    <Input aria-label="搜索资产" className="max-w-[260px]" allowClear prefix={<Search size={15} />} placeholder="搜索名称、款号、文案" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                    <Select aria-label="类型" className="min-w-26" allowClear placeholder="类型" options={[...assetKinds]} value={kind} onChange={setKind} />
                    <Select aria-label="完整款号" className="min-w-34" showSearch allowClear placeholder="完整款号" options={valuesOf(rows.map((asset) => asset.sku))} value={sku} onChange={setSKU} />
                    <Select aria-label="分类" className="min-w-28" showSearch={{ optionFilterProp: "label" }} allowClear placeholder="分类" options={[{ value: "", label: "未分类" }, ...categories.map((item) => ({ value: item.id, label: item.name }))]} value={categoryID} onChange={setCategoryID} />
                    <Select aria-label="文件夹" className="min-w-28" showSearch allowClear placeholder="文件夹" options={valuesOf(rows.map(folderOf))} value={folder} onChange={setFolder} />
                    <Select aria-label="来源" className="min-w-26" allowClear placeholder="来源" options={valuesOf(rows.map((asset) => asset.source))} value={source} onChange={setSource} />
                    <Select aria-label="用途" className="min-w-26" allowClear placeholder="用途" options={[...assetStages]} value={stage} onChange={setStage} />
                    <Select aria-label="时间" className="min-w-28" allowClear placeholder="入库时间" options={[{ value: 7, label: "近 7 天" }, { value: 30, label: "近 30 天" }]} value={period} onChange={setPeriod} />
                    <Select aria-label="标签" mode="multiple" maxTagCount="responsive" className="min-w-30 max-w-60" allowClear placeholder="标签" options={valuesOf(rows.flatMap((asset) => asset.tags || []))} value={tags} onChange={setTags} />
                </div>
                <div className="my-4 flex min-h-8 flex-wrap items-center gap-2 text-sm">
                    <Checkbox checked={visible.length > 0 && visible.every((asset) => selected.includes(asset.id))} disabled={!visible.length}
                        onChange={(event) => setSelected((items) => event.target.checked ? [...new Set([...items, ...visible.map((asset) => asset.id)])] : items.filter((id) => !visible.some((asset) => asset.id === id)))}>全选本页</Checkbox>
                    <span className="text-muted-foreground">{chosen.length ? `已选 ${chosen.length} 项` : `共 ${filtered.length} 项`}</span>
                    {chosen.length > 0 && (view === "trash"
                        ? <Button size="small" icon={<RotateCcw size={14} />} onClick={() => changeTrash(chosen, false)}>批量恢复</Button>
                        : <>
                            <Button size="small" onClick={() => setBatch({})}>批量整理</Button>
                            <Button size="small" loading={busy} icon={<Download size={14} />} onClick={() => void download(chosen)}>打包下载</Button>
                            <Button size="small" danger icon={<Trash2 size={14} />} onClick={() => changeTrash(chosen, true)}>移入回收站</Button>
                        </>)}
                    {view === "active" && !chosen.length && filtered.length > 0 && <Button size="small" loading={busy} onClick={() => void download(filtered)}>导出筛选结果</Button>}
                </div>
                <Spin spinning={loading}>
                    {visible.length ? (
                        <div className={layout === "grid" ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "space-y-2"}>
                            {visible.map((asset) => (
                                <article key={asset.id} className={`relative overflow-hidden rounded-xl border bg-card ${selected.includes(asset.id) ? "border-primary" : "border-border"} ${layout === "list" ? "flex items-center gap-3 pl-10" : ""}`}>
                                    <div className={`absolute z-10 ${layout === "list" ? "left-3 top-1/2 -translate-y-1/2" : "left-2 top-2 rounded-md bg-background/90 px-1"}`}>
                                        <Checkbox aria-label={`选择 ${asset.title}`} checked={selected.includes(asset.id)} onChange={(event) => changeSelection(asset.id, event.target.checked)} />
                                    </div>
                                    <button type="button" aria-label={`查看 ${asset.title}`} onClick={() => setDetail(asset)}
                                        className={layout === "list" ? "flex min-w-0 flex-1 items-center gap-3 text-left" : "block w-full text-left"}>
                                        <div className={`grid shrink-0 place-items-center overflow-hidden bg-muted text-muted-foreground ${layout === "list" ? "h-14 w-18 rounded-md" : "aspect-video w-full"}`}>
                                            <AssetCover asset={asset} />
                                        </div>
                                        <div className="min-w-0 flex-1 p-3">
                                            <div className="truncate font-medium" title={asset.title}>{asset.title}</div>
                                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                                <span>{kindText(asset)}</span>
                                                {asset.sku && <Tag className="m-0">{asset.sku}</Tag>}
                                                {stageText(asset) && <span>{stageText(asset)}</span>}
                                                {folderOf(asset) && <span className="inline-flex items-center gap-1"><FolderOpen size={12} />{folderOf(asset)}</span>}
                                            </div>
                                        </div>
                                    </button>
                                    {layout === "list" && <time className="hidden pr-4 text-xs text-muted-foreground sm:block">{dateText(asset.createdAt)}</time>}
                                </article>
                            ))}
                        </div>
                    ) : <Empty className="py-14" description={view === "trash" ? "回收站暂无资产" : assets.length ? "没有符合条件的资产" : "上传文件或从工作台保存生成结果"} />}
                </Spin>
                {maxPage > 1 && <Pagination className="mt-5 justify-end" current={Math.min(page, maxPage)} total={filtered.length} pageSize={PAGE_SIZE} showSizeChanger={false} onChange={setPage} />}
            </div>

            <AssetFormModal initialCategoryId={selectedCategory?.id} open={editing !== undefined} asset={editing} onClose={() => setEditing(undefined)} />

            <Drawer title={activeDetail?.title} open={Boolean(activeDetail)} onClose={() => setDetail(null)} size={490} destroyOnHidden>
                {activeDetail && <>
                    <AssetDetails key={activeDetail.id} asset={activeDetail} token={token} />
                    <div className="mt-5 flex flex-wrap gap-2">
                        <Button loading={busy} icon={<Download size={15} />} onClick={() => void download([activeDetail], false)}>下载原文件</Button>
                        {activeDetail.kind === "text" && <Button onClick={() => {
                            const content = activeDetail.data.content;
                            void navigator.clipboard.writeText(content).then(() => message.success("已复制文案"), () => message.error("复制失败"));
                        }}>复制文案</Button>}
                        {activeDetail.deletedAt
                            ? <Button icon={<RotateCcw size={15} />} onClick={() => changeTrash([activeDetail], false)}>恢复</Button>
                            : <>
                                <Button onClick={() => setEditing(activeDetail)}>编辑素材</Button>
                                {token && assetNeedsOriginalDevice(activeDetail) && <Button loading={busy} onClick={() => void migrate([activeDetail])}>从此设备补传原文件</Button>}
                                <Button danger icon={<Trash2 size={15} />} onClick={() => changeTrash([activeDetail], true)}>移入回收站</Button>
                            </>}
                    </div>
                </>}
            </Drawer>

            <Modal title={`整理 ${chosen.length} 项资产`} open={batch !== null} onCancel={() => setBatch(null)} onOk={applyBatch} okText="保存" cancelText="取消" confirmLoading={savingBatch} destroyOnHidden>
                {batch && <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">仅应用本次填写的字段。清空输入框会移除该字段。</p>
                    <Input aria-label="批量款号" placeholder="完整款号" maxLength={100} value={batch.sku ?? ""} onChange={(event) => setBatch({ ...batch, sku: event.target.value })} />
                    <Input aria-label="批量移动到文件夹" placeholder="移动到文件夹" maxLength={160} value={batch.folder ?? ""} onChange={(event) => setBatch({ ...batch, folder: event.target.value })} />
                    <Select aria-label="批量用途" className="w-full" placeholder="用途" options={[...assetStages]} value={batch.stage} onChange={(value) => setBatch({ ...batch, stage: value })} />
                    <Select aria-label="批量追加标签" mode="tags" className="w-full" placeholder="追加标签，回车确认" tokenSeparators={[",", "，"]} value={batch.tags || []} onChange={(value) => setBatch({ ...batch, tags: value })} />
                </div>}
            </Modal>

            <Modal title="批量上传" open={uploadOpen} onCancel={() => { if (!uploading) setUploadOpen(false); }} onOk={uploads.some((item) => !item.done) ? uploadQueued : () => setUploadOpen(false)}
                okText={uploads.length && uploads.every((item) => item.done) ? "完成" : uploads.some((item) => item.error) ? "重试失败项" : "开始上传"} cancelText="关闭" confirmLoading={uploading}
                okButtonProps={{ disabled: !uploads.length }} cancelButtonProps={{ disabled: uploading }} destroyOnHidden>
                <div className="space-y-3">
                    <div className="rounded-lg border border-dashed border-border p-5 text-center" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); queueFiles(event.dataTransfer.files); }}>
                        <Button icon={<Upload size={15} />} disabled={uploading} onClick={() => filesRef.current?.click()}>选择文件</Button>
                        <p className="mt-2 text-xs text-muted-foreground">可拖入多张图片、多个视频或音频。单个文件最多 256 MB。</p>
                        <input ref={filesRef} type="file" accept="image/*,video/*,audio/*" multiple hidden onChange={(event) => { queueFiles(event.target.files); event.target.value = ""; }} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <Input aria-label="上传款号" placeholder="完整款号" maxLength={100} disabled={uploading} value={uploadFields.sku} onChange={(event) => setUploadFields({ ...uploadFields, sku: event.target.value })} />
                        <Input aria-label="上传文件夹" placeholder="文件夹" maxLength={160} disabled={uploading} value={uploadFields.folder} onChange={(event) => setUploadFields({ ...uploadFields, folder: event.target.value })} />
                    </div>
                    {folders.length > 0 && <Select aria-label="选择已有文件夹" placeholder="或选择已有文件夹" className="w-full" options={folders} disabled={uploading} onChange={(value) => setUploadFields({ ...uploadFields, folder: value })} />}
                    <Select aria-label="上传标签" mode="tags" className="w-full" placeholder="标签，回车确认" tokenSeparators={[",", "，"]} disabled={uploading} value={uploadFields.tags} onChange={(value) => setUploadFields({ ...uploadFields, tags: value })} />
                    <ul className="max-h-64 space-y-2 overflow-y-auto">
                        {uploads.map((item) => <li key={item.id} className="rounded-md border border-border p-2">
                            <div className="flex items-center justify-between gap-2"><span className="truncate text-sm">{item.file.name}</span>
                                {!item.done && !uploading && <Button type="text" size="small" aria-label={`移除 ${item.file.name}`} onClick={() => setUploads((items) => items.filter(({ id }) => id !== item.id))}>移除</Button>}
                            </div>
                            <Progress percent={item.progress} size="small" status={item.error ? "exception" : undefined} />
                            {item.error && <p role="alert" className="text-xs text-destructive">{item.error}</p>}
                        </li>)}
                    </ul>
                </div>
            </Modal>
        </main>
    );
}

function AssetCover({ asset }: { asset: Asset }) {
    const [broken, setBroken] = useState(false);
    const url = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    useEffect(() => setBroken(false), [url]);
    if (url && !broken) return <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setBroken(true)} />;
    if (asset.kind === "video") return <Film size={26} />;
    if (asset.kind === "audio") return <AudioLines size={26} />;
    if (asset.kind === "text") return <span className="line-clamp-4 px-4 text-sm">{asset.data.content}</span>;
    return <FileText size={26} />;
}
