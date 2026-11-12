package repository

import (
	"errors"
	"fmt"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

type adminContentSource struct {
	key, section, table, owner, date, kind, payload, media, where string
	legacyArray, consolidated                                     string
}

var adminContentSources = []adminContentSource{
	{key: "file", section: "files", table: "storage_objects", owner: "created_by", date: "created_at", where: "COALESCE(deleted_at, '') = ''"},
	{key: "asset", section: "assets", table: "personal_assets", owner: "user_id", date: "updated_at", payload: "data"},
	{key: "legacy-asset", section: "assets", table: "user_configs", owner: "user_id", date: "updated_at", payload: "asset_data", legacyArray: "assets", consolidated: "personal_assets"},
	{key: "voice-asset", section: "results", table: "personal_assets", owner: "user_id", date: "updated_at", kind: "audio", payload: "data"},
	{key: "image-log", section: "results", table: "image_generation_logs", owner: "user_id", date: "created_at", kind: "image", payload: "payload_json", where: "COALESCE(deleted_at, '') = ''"},
	{key: "legacy-image-log", section: "results", table: "user_configs", owner: "user_id", date: "updated_at", kind: "image", payload: "image_history", legacyArray: "logs", consolidated: "image_generation_logs"},
	{key: "video-log", section: "results", table: "video_generation_logs", owner: "user_id", date: "created_at", kind: "video", payload: "payload_json", where: "COALESCE(deleted_at, '') = ''"},
	{key: "image-task", section: "results", table: "canvas_image_tasks", owner: "user_id", date: "created_at", kind: "image", media: "image_url",
		where: "(COALESCE(image_url, '') <> '' OR COALESCE(image_urls, '') NOT IN ('', 'null', '[]') OR COALESCE(storage_key, '') <> '') AND NOT EXISTS (SELECT 1 FROM image_generation_logs AS history WHERE history.user_id = resource.user_id AND history.task_id = resource.id)"},
	{key: "video-task", section: "results", table: "video_tasks", owner: "user_id", date: "created_at", kind: "video", media: "video_url",
		where: "COALESCE(video_url, '') <> '' AND NOT EXISTS (SELECT 1 FROM video_generation_logs AS history WHERE history.user_id = resource.user_id AND history.task_id = resource.id)"},
	{key: "audio-task", section: "results", table: "canvas_audio_tasks", owner: "user_id", date: "created_at", kind: "audio", media: "audio_url",
		where: "(COALESCE(audio_url, '') <> '' OR COALESCE(storage_key, '') <> '')"},
}

func adminContentJSON(db *gorm.DB, column, key string) string {
	switch db.Dialector.Name() {
	case "mysql":
		return fmt.Sprintf("CASE WHEN JSON_VALID(%s) THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(%s, '$.%s')), 'null') END", column, column, key)
	case "postgres":
		return fmt.Sprintf("CASE WHEN LEFT(LTRIM((%s)::text), 1) = '{' THEN %s::jsonb #>> '{%s}' END", column, column, strings.ReplaceAll(key, ".", ","))
	default:
		return fmt.Sprintf("CASE WHEN json_valid(%s) THEN json_extract(%s, '$.%s') END", column, column, key)
	}
}

func joinAdminLegacyContent(db, tx *gorm.DB, source adminContentSource, column string) (*gorm.DB, string) {
	switch db.Dialector.Name() {
	case "mysql":
		document := fmt.Sprintf("CASE WHEN JSON_VALID(%s) THEN %s ELSE '{}' END", column, column)
		join := fmt.Sprintf("JOIN JSON_TABLE(%s, '$.%s[*]' COLUMNS (entry_number FOR ORDINALITY)) AS legacy_row ON TRUE", document, source.legacyArray)
		item := fmt.Sprintf("JSON_EXTRACT(%s, CONCAT('$.%s[', legacy_row.entry_number - 1, ']'))", document, source.legacyArray)
		return tx.Joins(join), item
	case "postgres":
		array := fmt.Sprintf("COALESCE(NULLIF(%s, ''), '{}')::jsonb -> '%s'", column, source.legacyArray)
		join := fmt.Sprintf("CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(%s) = 'array' THEN %s ELSE '[]'::jsonb END) AS legacy_row(item)", array, array)
		return tx.Joins(join), "legacy_row.item"
	default:
		join := fmt.Sprintf("JOIN json_each(CASE WHEN json_valid(%s) THEN %s ELSE '{}' END, '$.%s') AS legacy_row ON TRUE", column, column, source.legacyArray)
		return tx.Joins(join).Where("legacy_row.type = 'object'"), "legacy_row.value"
	}
}

func adminContentSelect(db *gorm.DB, source adminContentSource) (query *gorm.DB, id, payload, projection string) {
	tx := db.Table(source.table + " AS resource")
	id = "resource.id"
	if source.payload != "" {
		payload = "resource." + source.payload
	}
	if source.legacyArray != "" {
		tx, payload = joinAdminLegacyContent(db, tx, source, payload)
		id = adminContentJSON(db, payload, "id")
		tx = tx.Where("COALESCE(" + id + ", '') <> ''").
			Where("NOT EXISTS (SELECT 1 FROM " + source.consolidated + " AS current_record WHERE current_record.user_id = resource.user_id AND current_record.id = " + id + ")")
	}

	title, kind, status, modelName, bytes, createdAt := "''", "'"+source.kind+"'", "''", "''", "0", "resource."+source.date
	if payload != "" {
		title = adminContentJSON(db, payload, "title")
		if source.key == "asset" || source.key == "legacy-asset" || source.key == "voice-asset" {
			kind = adminContentJSON(db, payload, "kind")
			status = fmt.Sprintf("CASE WHEN COALESCE(%s, '') <> '' THEN 'trash' ELSE '' END", adminContentJSON(db, payload, "deletedAt"))
			createdAt = fmt.Sprintf("COALESCE(NULLIF(%s, ''), resource.updated_at)", adminContentJSON(db, payload, "createdAt"))
		} else {
			modelName = adminContentJSON(db, payload, "model")
			status = "resource.status"
			if source.legacyArray != "" {
				status = adminContentJSON(db, payload, "status")
			}
		}
	} else if source.key == "file" {
		title, bytes = "resource.object_key", "resource.bytes"
		kind = "CASE WHEN resource.mime_type LIKE 'image/%' THEN 'image' WHEN resource.mime_type LIKE 'video/%' THEN 'video' WHEN resource.mime_type LIKE 'audio/%' THEN 'audio' ELSE 'file' END"
	} else {
		title, status, modelName = "resource.prompt", "resource.status", "resource.model"
		if source.key == "video-task" {
			title = adminContentJSON(db, "resource.request_body", "prompt")
		}
	}

	projection = fmt.Sprintf("%s AS id, resource.%s AS user_id, '%s' AS source, SUBSTR(COALESCE(%s, ''), 1, 240) AS title, COALESCE(%s, '') AS kind, COALESCE(%s, '') AS status, COALESCE(%s, '') AS model, %s AS created_at, resource.%s AS sort_at, %s AS bytes",
		id, source.owner, source.key, title, kind, status, modelName, createdAt, source.date, bytes)
	if source.where != "" {
		tx = tx.Where(source.where)
	}
	if source.key == "voice-asset" {
		tx = tx.Where(adminContentJSON(db, payload, "metadata.source")+" = ? AND COALESCE("+adminContentJSON(db, payload, "deletedAt")+", '') = ''", "voice-workbench")
	}
	return tx, id, payload, projection
}

func adminContentOwners(tx *gorm.DB) *gorm.DB {
	return tx.Joins("JOIN users AS owner ON owner.id = content.user_id").
		Where("owner.role IN ?", []model.UserRole{model.UserRoleAdmin, model.UserRoleUser})
}

func ListAdminContent(q model.AdminContentQuery) (model.AdminContentList, error) {
	db, err := DB()
	if err != nil {
		return model.AdminContentList{}, err
	}
	q.Normalize()
	var subqueries []any
	for _, source := range adminContentSources {
		if source.section != q.Section {
			continue
		}
		if q.Type != "" && q.Section == "results" && source.kind != q.Type {
			continue
		}
		tx, _, _, projection := adminContentSelect(db, source)
		tx = tx.Select(projection)
		if q.UserID != "" {
			tx = tx.Where("resource."+source.owner+" = ?", q.UserID)
		}
		subqueries = append(subqueries, tx)
	}
	list := model.AdminContentList{Items: make([]model.AdminContentRecord, 0)}
	if len(subqueries) == 0 {
		return list, nil
	}
	union := db.Raw(strings.TrimSuffix(strings.Repeat("? UNION ALL ", len(subqueries)), " UNION ALL "), subqueries...)
	tx := adminContentOwners(db.Table("(?) AS content", union))
	if q.Role != "" {
		tx = tx.Where("owner.role = ?", q.Role)
	}
	if q.Type != "" && q.Section != "results" {
		tx = tx.Where("content.kind = ?", q.Type)
	}
	if q.Keyword != "" {
		like := "%" + strings.ToLower(q.Keyword) + "%"
		tx = tx.Where("LOWER(owner.username) LIKE ? OR LOWER(owner.display_name) LIKE ? OR LOWER(content.title) LIKE ? OR LOWER(content.model) LIKE ?", like, like, like, like)
	}
	if err := tx.Count(&list.Total).Error; err != nil {
		return list, err
	}
	err = tx.Select("content.*, owner.username, owner.display_name, owner.role").
		Order("content.sort_at DESC, content.source, content.user_id, content.id DESC").
		Offset(q.Offset()).Limit(q.PageSize).Scan(&list.Items).Error
	return list, err
}

type AdminContentData struct {
	model.AdminContentRecord
	Payload    string
	MediaURL   string
	ImageURLs  string
	StorageKey string
	Prompt     string
}

func GetAdminContent(sourceKey, userID, id string) (AdminContentData, error) {
	db, err := DB()
	if err != nil {
		return AdminContentData{}, err
	}
	for _, source := range adminContentSources {
		if source.key != sourceKey {
			continue
		}
		var record AdminContentData
		tx, entryID, payload, extra := adminContentSelect(db, source)
		if payload != "" {
			extra += ", " + payload + " AS payload"
		}
		if source.media != "" {
			extra += ", resource." + source.media + " AS media_url"
			if source.kind != "video" {
				extra += ", resource.storage_key, resource.prompt"
			} else {
				extra += ", " + adminContentJSON(db, "resource.request_body", "prompt") + " AS prompt"
			}
			if source.kind == "image" {
				extra += ", resource.image_urls"
			}
		}
		tx = tx.Select(extra).Where("resource."+source.owner+" = ? AND "+entryID+" = ?", userID, id)
		err = adminContentOwners(db.Table("(?) AS content", tx)).
			Select("content.*, owner.username, owner.display_name, owner.role").Take(&record).Error
		return record, err
	}
	return AdminContentData{}, gorm.ErrRecordNotFound
}

func GetAdminFileForOwner(id, userID string) (model.StorageObject, bool, error) {
	db, err := DB()
	if err != nil {
		return model.StorageObject{}, false, err
	}
	var object model.StorageObject
	err = db.Where("id = ? AND created_by = ? AND COALESCE(deleted_at, '') = ''", id, userID).Take(&object).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.StorageObject{}, false, nil
	}
	return object, err == nil, err
}
