package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"path"
	"slices"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"gorm.io/gorm"
)

func AdminUserContent(ctx context.Context, q model.AdminContentQuery) (model.AdminContentList, error) {
	if err := requireContentAdmin(ctx); err != nil {
		return model.AdminContentList{}, err
	}
	if !slices.Contains([]string{"files", "assets", "results"}, q.Section) ||
		(q.Role != "" && q.Role != model.UserRoleAdmin && q.Role != model.UserRoleUser) ||
		(q.Type != "" && !slices.Contains([]string{"image", "video", "audio", "text", "file"}, q.Type)) {
		return model.AdminContentList{}, safeMessageError{message: "筛选条件无效"}
	}
	q.UserID = strings.TrimSpace(q.UserID)
	q.Keyword = strings.TrimSpace(q.Keyword)
	q.Normalize()
	q.PageSize = min(q.PageSize, 50)
	// Bound the offset before using the requested page to calculate it.
	if q.Page > 1000000 {
		return model.AdminContentList{}, safeMessageError{message: "页码超出范围"}
	}
	list, err := repository.ListAdminContent(q)
	for i := range list.Items {
		list.Items[i] = displayAdminContent(list.Items[i])
	}
	return list, err
}

func requireContentAdmin(ctx context.Context) error {
	user, ok := UserFromContext(ctx)
	if !ok || user.Role != model.UserRoleAdmin || user.ID == "" {
		return safeMessageError{message: "需要管理员权限"}
	}
	return nil
}

func displayAdminContent(item model.AdminContentRecord) model.AdminContentRecord {
	if item.Source == "file" && item.Title != "" {
		item.Title = path.Base(item.Title)
	}
	if strings.TrimSpace(item.Title) == "" {
		item.Title = item.Model
		if item.Title == "" {
			item.Title = item.ID
		}
	}
	return item
}

type adminMediaEntry struct {
	URL        string `json:"url"`
	DataURL    string `json:"dataUrl"`
	StorageKey string `json:"storageKey"`
	Content    string `json:"content"`
	Bytes      int64  `json:"bytes"`
}

func AdminUserContentDetail(ctx context.Context, source, userID, id string) (model.AdminContentDetail, error) {
	if err := requireContentAdmin(ctx); err != nil {
		return model.AdminContentDetail{}, err
	}
	if source == "" || userID == "" || id == "" {
		return model.AdminContentDetail{}, safeMessageError{message: "内容编号无效"}
	}
	record, err := repository.GetAdminContent(source, userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.AdminContentDetail{}, safeMessageError{message: "找不到该内容"}
	}
	if err != nil {
		return model.AdminContentDetail{}, err
	}
	result := model.AdminContentDetail{AdminContentRecord: displayAdminContent(record.AdminContentRecord), Prompt: record.Prompt}
	addMedia := func(entries ...adminMediaEntry) error {
		for _, entry := range entries {
			mediaURL, err := adminContentMediaURL(userID, result.Kind, entry)
			if err != nil {
				return err
			}
			if mediaURL != "" && !slices.Contains(result.Media, mediaURL) {
				result.Media = append(result.Media, mediaURL)
			}
		}
		return nil
	}
	switch source {
	case "file":
		err = addMedia(adminMediaEntry{StorageKey: "server:" + id})
	case "asset", "legacy-asset", "voice-asset":
		var payload struct {
			Category string          `json:"category"`
			Folder   string          `json:"folder"`
			SKU      string          `json:"sku"`
			Tags     []string        `json:"tags"`
			Data     adminMediaEntry `json:"data"`
			Metadata struct {
				Prompt string `json:"prompt"`
				Model  string `json:"model"`
			} `json:"metadata"`
		}
		if json.Unmarshal([]byte(record.Payload), &payload) == nil {
			result.Category, result.Folder, result.SKU, result.Tags = payload.Category, payload.Folder, payload.SKU, payload.Tags
			result.Prompt, result.Model, result.Bytes = payload.Metadata.Prompt, payload.Metadata.Model, payload.Data.Bytes
			if result.Kind == "text" {
				result.Text = payload.Data.Content
			} else {
				err = addMedia(payload.Data)
			}
		}
	case "image-log", "legacy-image-log", "video-log":
		var payload struct {
			Prompt string            `json:"prompt"`
			Images []adminMediaEntry `json:"images"`
			Image  adminMediaEntry   `json:"image"`
			Video  adminMediaEntry   `json:"video"`
			Result adminMediaEntry   `json:"result"`
			Output adminMediaEntry   `json:"output"`
			Task   struct {
				ImageURL   string   `json:"image_url"`
				ImageURLs  []string `json:"image_urls"`
				VideoURL   string   `json:"video_url"`
				StorageKey string   `json:"storage_key"`
			} `json:"task"`
		}
		if json.Unmarshal([]byte(record.Payload), &payload) == nil {
			result.Prompt = payload.Prompt
			if result.Kind == "image" {
				err = addMedia(append(payload.Images, payload.Image, payload.Result, payload.Output)...)
				if err == nil && len(result.Media) == 0 {
					err = addMedia(adminMediaEntry{URL: payload.Task.ImageURL, StorageKey: payload.Task.StorageKey})
					for _, value := range payload.Task.ImageURLs {
						if err == nil {
							err = addMedia(adminMediaEntry{URL: value})
						}
					}
				}
			} else {
				err = addMedia(payload.Video, payload.Result, payload.Output, adminMediaEntry{URL: payload.Task.VideoURL})
			}
		}
	default:
		err = addMedia(adminMediaEntry{URL: record.MediaURL, StorageKey: record.StorageKey})
		if source == "image-task" && err == nil {
			var urls []string
			_ = json.Unmarshal([]byte(record.ImageURLs), &urls)
			for _, value := range urls {
				if err == nil {
					err = addMedia(adminMediaEntry{URL: value})
				}
			}
		}
	}
	return result, err
}

func adminContentMediaURL(userID, kind string, entry adminMediaEntry) (string, error) {
	if id, ok := strings.CutPrefix(entry.StorageKey, "server:"); ok && personalAssetID.MatchString(id) {
		if _, found, err := repository.GetAdminFileForOwner(id, userID); err != nil {
			return "", err
		} else if found {
			return "/api/files/" + url.PathEscape(id) + "/content", nil
		}
	}
	for _, raw := range []string{entry.URL, entry.DataURL} {
		raw = strings.TrimSpace(raw)
		if (kind == "image" || kind == "audio" || kind == "video") && strings.HasPrefix(raw, "data:"+kind+"/") {
			header, _, ok := strings.Cut(raw, ",")
			if ok && strings.HasSuffix(header, ";base64") && !strings.HasPrefix(header, "data:image/svg") {
				return raw, nil
			}
		}
		parsed, err := url.Parse(raw)
		if err != nil {
			continue
		}
		if parsed.Host == "" && parsed.Scheme == "" {
			if file, ok := strings.CutPrefix(parsed.Path, "/api/files/"); ok {
				id, ok := strings.CutSuffix(file, "/content")
				if ok && personalAssetID.MatchString(id) {
					if _, found, err := repository.GetAdminFileForOwner(id, userID); err != nil {
						return "", err
					} else if found {
						return "/api/files/" + url.PathEscape(id) + "/content", nil
					}
				}
			}
		} else if (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Host != "" && parsed.User == nil {
			return raw, nil
		}
	}
	return "", nil
}
