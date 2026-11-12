package service

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

var personalAssetID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type PersonalAssetFields struct {
	ID         string   `json:"id"`
	Kind       string   `json:"kind"`
	Title      string   `json:"title"`
	Category   string   `json:"category"`
	CategoryID *string  `json:"categoryId"`
	Folder     string   `json:"folder"`
	SKU        string   `json:"sku"`
	Stage      string   `json:"stage"`
	Source     string   `json:"source"`
	Tags       []string `json:"tags"`
	CreatedAt  string   `json:"createdAt"`
	UpdatedAt  string   `json:"updatedAt"`
	Data       struct {
		StorageKey string `json:"storageKey"`
		URL        string `json:"url"`
		DataURL    string `json:"dataUrl"`
	} `json:"data"`
}

type PersonalAssetReference struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func personalAssetOwner(ctx context.Context) (string, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" || user.Role == model.UserRoleGuest {
		return "", safeMessageError{message: "请先登录"}
	}
	return user.ID, nil
}

func personalAssetRecord(owner string, raw json.RawMessage) (model.PersonalAsset, PersonalAssetFields, error) {
	var fields PersonalAssetFields
	if err := json.Unmarshal(raw, &fields); err != nil || !personalAssetID.MatchString(fields.ID) ||
		!slices.Contains([]string{"text", "image", "video", "audio"}, fields.Kind) {
		return model.PersonalAsset{}, fields, safeMessageError{message: "资产格式无效"}
	}
	return model.PersonalAsset{UserID: owner, ID: fields.ID, Data: string(raw), StorageKey: fields.Data.StorageKey, UpdatedAt: fields.UpdatedAt}, fields, nil
}

func validatePersonalAsset(record model.PersonalAsset, fields PersonalAssetFields) error {
	if strings.TrimSpace(fields.Title) == "" || utf8.RuneCountInString(fields.Title) > 255 ||
		utf8.RuneCountInString(fields.Folder) > 160 || utf8.RuneCountInString(fields.SKU) > 100 ||
		len(fields.Tags) > 50 || (fields.Stage != "" && !slices.Contains([]string{"original", "candidate", "final"}, fields.Stage)) {
		return safeMessageError{message: "请检查资产名称、文件夹、款号、标签和用途"}
	}
	if strings.HasPrefix(record.StorageKey, "server:") {
		id := strings.TrimPrefix(record.StorageKey, "server:")
		object, err := repository.GetStorageObject(id)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if object.ProviderID == personalAssetFileProvider && object.CreatedBy != record.UserID {
			return safeMessageError{message: "无权使用该资产文件"}
		}
	}
	return nil
}

func CurrentPersonalAssets(ctx context.Context) ([]json.RawMessage, error) {
	owner, err := personalAssetOwner(ctx)
	if err != nil {
		return nil, err
	}
	if err := importLegacyPersonalAssets(owner); err != nil {
		return nil, err
	}
	records, err := repository.ListPersonalAssets(owner)
	return personalAssetData(records), err
}

func importLegacyPersonalAssets(owner string) error {
	snapshot, err := repository.LegacyPersonalAssetData(owner)
	if err != nil || snapshot == "" {
		return err
	}
	var legacy struct{ Assets []json.RawMessage }
	if json.Unmarshal([]byte(snapshot), &legacy) != nil || len(legacy.Assets) == 0 {
		return nil
	}
	ids, err := repository.ListPersonalAssetIDs(owner)
	if err != nil {
		return err
	}
	known := make(map[string]bool, len(ids))
	for _, id := range ids {
		known[id] = true
	}
	var missing []model.PersonalAsset
	for _, raw := range legacy.Assets {
		record, _, parseErr := personalAssetRecord(owner, raw)
		if parseErr == nil && !known[record.ID] {
			missing = append(missing, record)
			known[record.ID] = true
		}
	}
	return repository.CreatePersonalAssets(missing)
}

func CreatePersonalAsset(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	owner, err := personalAssetOwner(ctx)
	if err != nil {
		return nil, err
	}
	record, fields, err := personalAssetRecord(owner, raw)
	if err != nil {
		return nil, err
	}
	if err = validatePersonalAsset(record, fields); err != nil {
		return nil, err
	}
	var asset map[string]json.RawMessage
	_ = json.Unmarshal(raw, &asset)
	delete(asset, "deletedAt")
	delete(asset, "categoryId")
	updatedAt := time.Now().UTC().Format(time.RFC3339Nano)
	timestamp, _ := json.Marshal(updatedAt)
	asset["createdAt"], asset["updatedAt"] = timestamp, timestamp
	record, err = repository.CreateManagedPersonalAsset(record, fields.CategoryID, func(record *model.PersonalAsset, category *string) error {
		if category != nil {
			asset["category"], _ = json.Marshal(*category)
		}
		data, err := json.Marshal(asset)
		if err != nil {
			return err
		}
		record.Data, record.UpdatedAt = string(data), updatedAt
		return nil
	})
	if errors.Is(err, repository.ErrPersonalAssetCategoryNotFound) {
		return nil, safeMessageError{message: "分类已删除，请刷新后重试"}
	}
	return json.RawMessage(record.Data), err
}

func UpdatePersonalAssets(ctx context.Context, ids []string, patch map[string]json.RawMessage) ([]json.RawMessage, error) {
	owner, err := personalAssetOwner(ctx)
	if err != nil {
		return nil, err
	}
	slices.Sort(ids)
	ids = slices.Compact(ids)
	if len(ids) == 0 || len(ids) > 1000 || len(patch) == 0 {
		return nil, safeMessageError{message: "请选择要处理的资产"}
	}
	for _, id := range ids {
		if !personalAssetID.MatchString(id) {
			return nil, safeMessageError{message: "资产编号无效"}
		}
	}
	for key := range patch {
		if !slices.Contains([]string{"title", "category", "categoryId", "folder", "sku", "stage", "tags", "kind", "data", "coverUrl", "source", "metadata", "trashed", "addTags"}, key) {
			return nil, safeMessageError{message: "资产字段无效"}
		}
	}
	var addedTags []string
	if raw, ok := patch["addTags"]; ok {
		if err := json.Unmarshal(raw, &addedTags); err != nil {
			return nil, safeMessageError{message: "标签格式无效"}
		}
		delete(patch, "addTags")
	}
	var categoryID *string
	if raw, exists := patch["categoryId"]; exists {
		var id string
		if err := json.Unmarshal(raw, &id); err != nil {
			return nil, safeMessageError{message: "分类编号无效"}
		}
		categoryID = &id
		delete(patch, "categoryId")
	}
	records, err := repository.EditPersonalAssets(owner, ids, categoryID, func(record *model.PersonalAsset, category *string) error {
		var asset map[string]json.RawMessage
		if err := json.Unmarshal([]byte(record.Data), &asset); err != nil {
			return err
		}
		timestamp, _ := json.Marshal(time.Now().UTC().Format(time.RFC3339Nano))
		for key, value := range patch {
			if key == "trashed" {
				var trashed bool
				if err := json.Unmarshal(value, &trashed); err != nil {
					return safeMessageError{message: "回收站状态无效"}
				}
				if !trashed {
					if deletedAt, _ := time.Parse(time.RFC3339Nano, strings.Trim(string(asset["deletedAt"]), `"`)); !deletedAt.IsZero() && deletedAt.Before(time.Now().Add(-30*24*time.Hour)) {
						return safeMessageError{message: "资产已超过恢复期限"}
					}
					delete(asset, "deletedAt")
				} else if len(asset["deletedAt"]) == 0 {
					asset["deletedAt"] = timestamp
				}
				continue
			}
			asset[key] = value
		}
		if category != nil {
			asset["category"], _ = json.Marshal(*category)
		}
		if len(addedTags) > 0 {
			var tags []string
			_ = json.Unmarshal(asset["tags"], &tags)
			for _, tag := range addedTags {
				tag = strings.TrimSpace(tag)
				if tag != "" && !slices.Contains(tags, tag) {
					tags = append(tags, tag)
				}
			}
			asset["tags"], _ = json.Marshal(tags)
		}
		asset["updatedAt"] = timestamp
		raw, err := json.Marshal(asset)
		if err != nil {
			return err
		}
		updated, fields, err := personalAssetRecord(owner, raw)
		if err != nil {
			return err
		}
		if len(addedTags) > 0 || patch["data"] != nil || patch["title"] != nil || patch["folder"] != nil || patch["sku"] != nil || patch["tags"] != nil || patch["stage"] != nil {
			if err := validatePersonalAsset(updated, fields); err != nil {
				return err
			}
		}
		*record = updated
		return nil
	})
	if errors.Is(err, repository.ErrPersonalAssetCategoryNotFound) {
		return nil, safeMessageError{message: "分类已删除，请刷新后重试"}
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, safeMessageError{message: "资产不存在或已不可用"}
	}
	return personalAssetData(records), err
}

func personalAssetData(records []model.PersonalAsset) []json.RawMessage {
	result := make([]json.RawMessage, 0, len(records))
	for _, record := range records {
		result = append(result, json.RawMessage(record.Data))
	}
	return result
}

func PersonalAssetReferences(ctx context.Context, id string) ([]PersonalAssetReference, error) {
	owner, err := personalAssetOwner(ctx)
	if err != nil {
		return nil, err
	}
	record, err := repository.GetPersonalAsset(owner, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, safeMessageError{message: "资产不存在"}
	}
	if err != nil {
		return nil, err
	}
	_, fields, err := personalAssetRecord(owner, json.RawMessage(record.Data))
	if err != nil {
		return nil, err
	}
	projects, err := repository.ListUserCanvasProjects(owner)
	if err != nil {
		return nil, err
	}
	result := make([]PersonalAssetReference, 0)
	for _, project := range projects {
		var data struct {
			Name  string `json:"name"`
			Title string `json:"title"`
			Nodes any    `json:"nodes"`
		}
		if json.Unmarshal([]byte(project.ProjectData), &data) == nil && assetReferenced(data.Nodes, fields) {
			name := data.Name
			if name == "" {
				name = data.Title
			}
			result = append(result, PersonalAssetReference{ID: project.ID, Name: name})
		}
	}
	return result, nil
}

func assetReferenced(value any, asset PersonalAssetFields) bool {
	switch value := value.(type) {
	case []any:
		for _, child := range value {
			if assetReferenced(child, asset) {
				return true
			}
		}
	case map[string]any:
		if value["assetId"] == asset.ID || (asset.Data.StorageKey != "" && value["storageKey"] == asset.Data.StorageKey) {
			return true
		}
		for key, child := range value {
			if url, ok := child.(string); ok && url != "" && (key == "content" || key == "url" || key == "dataUrl") &&
				(url == asset.Data.URL || url == asset.Data.DataURL) && !strings.HasPrefix(url, "blob:") {
				return true
			}
			if assetReferenced(child, asset) {
				return true
			}
		}
	}
	return false
}
