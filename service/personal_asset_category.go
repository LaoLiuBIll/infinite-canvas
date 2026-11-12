package service

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type PersonalAssetCategoryResult struct {
	Categories []model.PersonalAssetCategory `json:"categories"`
	Assets     []json.RawMessage             `json:"assets"`
}

func validPersonalAssetCategoryName(name string) bool {
	return name != "" && name != "未分类" && utf8.RuneCountInString(name) <= 100 && !strings.ContainsAny(name, "\r\n\t")
}

func PersonalAssetCategories(ctx context.Context) (PersonalAssetCategoryResult, error) {
	return changePersonalAssetCategory(ctx, "", "", "")
}

func SavePersonalAssetCategory(ctx context.Context, id, name string) (PersonalAssetCategoryResult, error) {
	name = strings.TrimSpace(name)
	if !validPersonalAssetCategoryName(name) {
		return PersonalAssetCategoryResult{}, safeMessageError{message: "请输入 1–100 字的分类名称。「未分类」是系统选项"}
	}
	return changePersonalAssetCategory(ctx, "save", id, name)
}

func DeletePersonalAssetCategory(ctx context.Context, id string) (PersonalAssetCategoryResult, error) {
	return changePersonalAssetCategory(ctx, "delete", id, "")
}

func changePersonalAssetCategory(ctx context.Context, action, id, name string) (PersonalAssetCategoryResult, error) {
	owner, err := personalAssetOwner(ctx)
	if err != nil {
		return PersonalAssetCategoryResult{}, err
	}
	// Load any old snapshot entries before collecting categories from persisted assets.
	if err := importLegacyPersonalAssets(owner); err != nil {
		return PersonalAssetCategoryResult{}, err
	}
	result := PersonalAssetCategoryResult{}
	err = repository.ChangePersonalAssetCategories(owner, func(categories []model.PersonalAssetCategory, assets []model.PersonalAsset) (repository.PersonalAssetCategoryChanges, error) {
		changes := repository.PersonalAssetCategoryChanges{}
		known := make(map[string]bool, len(categories))
		for _, category := range categories {
			known[strings.ToLower(category.Name)] = true
		}
		names := make([]string, len(assets))
		for i, asset := range assets {
			var fields struct{ Category string }
			if json.Unmarshal([]byte(asset.Data), &fields) != nil {
				continue
			}
			name := strings.TrimSpace(fields.Category)
			names[i] = name
			key := strings.ToLower(name)
			if validPersonalAssetCategoryName(name) && !known[key] {
				category := model.PersonalAssetCategory{ID: uuid.NewString(), UserID: owner, Name: name}
				categories = append(categories, category)
				changes.Save = append(changes.Save, category)
				known[key] = true
			}
		}
		if action != "" {
			index := slices.IndexFunc(categories, func(category model.PersonalAssetCategory) bool { return category.ID == id })
			if (id != "" || action == "delete") && index == -1 {
				return changes, safeMessageError{message: "分类不存在，请刷新后重试"}
			}
			if action == "save" {
				for _, category := range categories {
					if category.ID != id && strings.EqualFold(category.Name, name) {
						return changes, safeMessageError{message: "分类名称已存在"}
					}
				}
			}
			if index == -1 {
				category := model.PersonalAssetCategory{ID: uuid.NewString(), UserID: owner, Name: name}
				categories = append(categories, category)
				changes.Save = append(changes.Save, category)
			} else {
				previous := categories[index]
				if action == "delete" {
					changes.Remove = previous.ID
					categories = slices.Delete(categories, index, index+1)
				} else {
					categories[index].Name = name
					changes.Save = append(changes.Save, categories[index])
				}
				if previous.Name != name {
					timestamp := time.Now().UTC().Format(time.RFC3339Nano)
					for i, asset := range assets {
						if !strings.EqualFold(names[i], previous.Name) {
							continue
						}
						var fields map[string]json.RawMessage
						if err := json.Unmarshal([]byte(asset.Data), &fields); err != nil {
							return changes, err
						}
						fields["category"], _ = json.Marshal(name)
						if len(fields["folder"]) == 0 || string(fields["folder"]) == "null" {
							fields["folder"], _ = json.Marshal(names[i])
						}
						fields["updatedAt"], _ = json.Marshal(timestamp)
						raw, err := json.Marshal(fields)
						if err != nil {
							return changes, err
						}
						asset.Data, asset.UpdatedAt = string(raw), timestamp
						changes.Assets = append(changes.Assets, asset)
					}
				}
			}
		}
		result.Categories = append([]model.PersonalAssetCategory{}, categories...)
		if action == "" {
			result.Assets = personalAssetData(assets)
		} else {
			result.Assets = personalAssetData(changes.Assets)
		}
		return changes, nil
	})
	return result, err
}
