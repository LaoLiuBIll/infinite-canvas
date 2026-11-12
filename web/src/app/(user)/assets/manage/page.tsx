"use client";

import { useMemo, useState } from "react";
import { Alert, App, Button, Drawer, Input, Modal, Select, Table, Tabs, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { ArrowLeft, Pencil, Plus, RotateCcw, Search, Trash2 } from "lucide-react";

import { AssetDetails } from "@/components/assets/asset-details";
import { AssetFormModal } from "@/components/assets/asset-form-modal";
import { assetKinds, assetSearchText, isAssetRecoverable } from "@/services/personal-asset-media";
import { categoryKey, useAssetStore, type Asset, type AssetCategory } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";

const errorText = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试";
const tablePagination = { pageSize: 15, hideOnSinglePage: true };
type Section = "assets" | "categories" | "trash";

export default function AssetManagementPage() {
    const { message, modal } = App.useApp();
    const assets = useAssetStore((state) => state.assets);
    const trash = useAssetStore((state) => state.trash);
    const categories = useAssetStore((state) => state.categories);
    const loading = useAssetStore((state) => state.loading);
    const loadError = useAssetStore((state) => state.loadError);
    const token = useUserStore((state) => state.user ? state.token : "");
    const [section, setSection] = useState<Section>("assets");
    const [keyword, setKeyword] = useState("");
    const [categorySearch, setCategorySearch] = useState("");
    const [categoryID, setCategoryID] = useState<string>();
    const [kind, setKind] = useState<string>();
    const [editAsset, setEditAsset] = useState<Asset | null>();
    const [detailsID, setDetailsID] = useState<string>();
    const [editCategory, setEditCategory] = useState<{ id?: string; name: string }>();
    const [savingCategory, setSavingCategory] = useState(false);
    const [categoryError, setCategoryError] = useState("");
    const category = categories.find((item) => item.id === categoryID);
    const details = assets.find((asset) => asset.id === detailsID) || trash.find((asset) => asset.id === detailsID);
    const counts = useMemo(() => {
        const result = new Map<string, number>();
        for (const asset of assets) {
            const key = categoryKey(asset.category);
            result.set(key, (result.get(key) || 0) + 1);
        }
        return result;
    }, [assets]);
    const recoverable = useMemo(() => trash.filter(isAssetRecoverable), [trash]);
    const displayedAssets = (section === "trash" ? recoverable : assets).filter((asset) =>
        (!kind || asset.kind === kind) &&
        (categoryID === "" ? !categoryKey(asset.category) : !category || categoryKey(asset.category) === categoryKey(category.name)) &&
        assetSearchText(asset).includes(keyword.trim().toLowerCase()));
    const displayedCategories = [...categories]
        .filter((item) => categoryKey(item.name).includes(categoryKey(categorySearch)))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

    const openCategoryEditor = (value: { id?: string; name: string }) => {
        setCategoryError("");
        setEditCategory(value);
    };

    const saveCategory = async () => {
        if (!editCategory) return;
        setSavingCategory(true);
        setCategoryError("");
        try {
            await useAssetStore.getState().saveCategory(editCategory.name, editCategory.id);
            message.success(editCategory.id ? "分类已更新" : "分类已创建");
            setEditCategory(undefined);
        } catch (error) {
            setCategoryError(errorText(error));
        } finally {
            setSavingCategory(false);
        }
    };

    const removeCategory = (item: AssetCategory) => {
        modal.confirm({
            title: `删除分类「${item.name}」？`,
            content: "该分类下的资产会转为未分类，原文件和画布引用继续保留。",
            okText: "删除分类",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await useAssetStore.getState().deleteCategory(item.id);
                    setCategoryID((value) => value === item.id ? undefined : value);
                    message.success("分类已删除，关联资产已转为未分类");
                } catch (error) {
                    message.error(errorText(error));
                    throw error;
                }
            },
        });
    };

    const setTrashed = async (asset: Asset, trashed: boolean) => {
        try {
            await useAssetStore.getState().updateAsset(asset.id, { trashed });
            setDetailsID(undefined);
            message.success(trashed ? "资产已移入回收站" : "资产已恢复");
        } catch (error) {
            message.error(errorText(error));
        }
    };

    const removeAsset = (asset: Asset) => modal.confirm({
        title: `将「${asset.title}」移入回收站？`,
        content: "30 天内可恢复，已引用的画布仍能使用原文件。",
        okText: "移入回收站",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: () => setTrashed(asset, true),
    });

    const assetColumns: TableColumnsType<Asset> = [
        {
            title: "资产名称", dataIndex: "title", key: "title", ellipsis: true,
            render: (title, asset) => <Button type="link" className="max-w-full px-0" aria-label={`查看资产 ${title}`} onClick={() => setDetailsID(asset.id)}><span className="truncate">{title}</span></Button>,
        },
        { title: "类型", key: "kind", width: 90, render: (_, asset) => assetKinds.find((item) => item.value === asset.kind)?.label },
        { title: "分类", key: "category", width: 155, ellipsis: true, render: (_, asset) => categoryKey(asset.category) ? <Tag>{asset.category}</Tag> : <span className="text-muted-foreground">未分类</span> },
        { title: "完整款号", key: "sku", width: 160, ellipsis: true, render: (_, asset) => asset.sku || "—" },
        { title: section === "trash" ? "删除时间" : "更新时间", key: "updatedAt", width: 125, render: (_, asset) => new Date(asset.deletedAt || asset.updatedAt || asset.createdAt).toLocaleDateString("zh-CN") },
        {
            title: "操作", key: "actions", width: 170,
            render: (_, asset) => asset.deletedAt ? (
                <Button size="small" icon={<RotateCcw size={14} />} aria-label={`恢复资产 ${asset.title}`} onClick={() => void setTrashed(asset, false)}>恢复</Button>
            ) : (
                <div className="flex flex-wrap gap-2">
                    <Button size="small" icon={<Pencil size={14} />} aria-label={`编辑资产 ${asset.title}`} onClick={() => setEditAsset(asset)}>编辑</Button>
                    <Button size="small" danger icon={<Trash2 size={14} />} aria-label={`删除资产 ${asset.title}`} onClick={() => removeAsset(asset)}>删除</Button>
                </div>
            ),
        },
    ];

    const categoryColumns: TableColumnsType<AssetCategory> = [
        {
            title: "分类名称", dataIndex: "name", key: "name", ellipsis: true,
            render: (name, item) => <Button type="link" className="max-w-full px-0" aria-label={`查看分类 ${name}`} onClick={() => { setKeyword(""); setKind(undefined); setCategoryID(item.id); setSection("assets"); }}><span className="truncate">{name}</span></Button>,
        },
        { title: "资产数量", key: "count", width: 140, render: (_, item) => counts.get(categoryKey(item.name)) || 0 },
        {
            title: "操作", key: "actions", width: 170, render: (_, item) => (
                <div className="flex flex-wrap gap-2">
                    <Button size="small" icon={<Pencil size={14} />} aria-label={`编辑分类 ${item.name}`} onClick={() => openCategoryEditor(item)}>编辑</Button>
                    <Button size="small" danger icon={<Trash2 size={14} />} aria-label={`删除分类 ${item.name}`} onClick={() => removeCategory(item)}>删除</Button>
                </div>
            ),
        },
    ];

    return (
        <main className="h-full overflow-auto bg-background text-foreground">
            <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8">
                <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-5">
                    <h1 className="text-2xl font-semibold">资产管理</h1>
                    <Button href="/assets" icon={<ArrowLeft size={15} />}>返回资产中心</Button>
                </header>
                {loadError && <Alert className="mt-4" type="error" showIcon title={loadError} action={<Button size="small" onClick={() => void useAssetStore.getState().load()}>重试</Button>} />}
                <Tabs activeKey={section} onChange={(value) => setSection(value as Section)} items={[
                    { key: "assets", label: `资产 ${assets.length}` },
                    { key: "categories", label: `分类 ${categories.length}` },
                    { key: "trash", label: `回收站 ${recoverable.length}` },
                ]} />
                {section === "categories" ? (
                    <>
                        <div className="mb-4 flex flex-wrap justify-between gap-2">
                            <Input aria-label="搜索分类" className="max-w-72" allowClear prefix={<Search size={15} />} placeholder="搜索分类名称" value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} />
                            <Button type="primary" icon={<Plus size={15} />} disabled={loading || Boolean(loadError)} onClick={() => openCategoryEditor({ name: "" })}>新增分类</Button>
                        </div>
                        <Table rowKey="id" columns={categoryColumns} dataSource={displayedCategories} loading={loading} pagination={tablePagination} scroll={{ x: 520 }} locale={{ emptyText: categorySearch ? "没有匹配的分类" : "暂无分类" }} />
                    </>
                ) : (
                    <>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap gap-2">
                                <Input aria-label="搜索管理资产" className="w-64" allowClear prefix={<Search size={15} />} placeholder="搜索名称、款号、文案" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
                                <Select aria-label="筛选资产类型" className="min-w-24" allowClear placeholder="类型" options={[...assetKinds]} value={kind} onChange={setKind} />
                                <Select aria-label="筛选资产分类" className="min-w-32" showSearch={{ optionFilterProp: "label" }} allowClear placeholder="分类" options={[{ label: "未分类", value: "" }, ...categories.map((item) => ({ label: item.name, value: item.id }))]} value={categoryID === "" ? "" : category?.id} onChange={setCategoryID} />
                            </div>
                            {section === "assets" && <Button type="primary" icon={<Plus size={15} />} disabled={loading || Boolean(loadError)} onClick={() => setEditAsset(null)}>新增资产</Button>}
                        </div>
                        <Table rowKey="id" columns={assetColumns} dataSource={displayedAssets} loading={loading} pagination={tablePagination} scroll={{ x: 800 }} locale={{ emptyText: section === "trash" ? "回收站暂无匹配的资产" : "暂无匹配的资产" }} />
                    </>
                )}
            </div>

            <AssetFormModal initialCategoryId={category?.id} open={editAsset !== undefined} asset={editAsset} onClose={() => setEditAsset(undefined)} />
            <Drawer title={details?.title} open={Boolean(details)} onClose={() => setDetailsID(undefined)} size={490} destroyOnHidden>
                {details && <AssetDetails key={details.id} asset={details} token={token} />}
            </Drawer>
            <Modal title={editCategory?.id ? "编辑分类" : "新增分类"} open={Boolean(editCategory)} onCancel={() => { if (!savingCategory) setEditCategory(undefined); }} onOk={saveCategory} okText="保存" cancelText="取消" confirmLoading={savingCategory} destroyOnHidden>
                {editCategory && <div className="space-y-2">
                    <label htmlFor="asset-category-name" className="block text-sm font-medium">分类名称</label>
                    <Input id="asset-category-name" maxLength={100} value={editCategory.name} onChange={(event) => { setCategoryError(""); setEditCategory({ ...editCategory, name: event.target.value }); }} onPressEnter={() => { if (!savingCategory) void saveCategory(); }} />
                    {categoryError && <p className="text-sm text-destructive" role="alert">{categoryError}</p>}
                </div>}
            </Modal>
        </main>
    );
}
