package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

const personalAssetFileProvider = "personal-asset-files"
const MaxPersonalAssetBytes = 256_000_000

func SavePersonalAssetFile(ctx context.Context, input io.Reader, contentType string) (UploadedStorageObject, error) {
	owner, err := personalAssetOwner(ctx)
	if err != nil {
		return UploadedStorageObject{}, err
	}
	prefix := make([]byte, 512)
	n, err := io.ReadFull(input, prefix)
	if err != nil && err != io.ErrUnexpectedEOF {
		return UploadedStorageObject{}, safeMessageError{message: "无法读取上传文件"}
	}
	prefix = prefix[:n]
	mime := http.DetectContentType(prefix)
	declared := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	if (mime == "application/octet-stream" || mime == "application/ogg") &&
		slices.Contains([]string{"audio/aac", "audio/flac", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/x-m4a", "video/quicktime"}, declared) {
		mime = declared
	} else if mime == "video/mp4" && strings.HasPrefix(declared, "audio/") {
		mime = "audio/mp4"
	} else if mime == "video/webm" && declared == "audio/webm" {
		mime = declared
	}
	if !strings.HasPrefix(mime, "image/") && !strings.HasPrefix(mime, "video/") && !strings.HasPrefix(mime, "audio/") {
		return UploadedStorageObject{}, safeMessageError{message: "请选择支持的图片、视频或音频文件"}
	}
	if err := os.MkdirAll(config.Cfg.AssetFileDir, 0700); err != nil {
		return UploadedStorageObject{}, err
	}
	file, err := os.CreateTemp(config.Cfg.AssetFileDir, ".upload-")
	if err != nil {
		return UploadedStorageObject{}, err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	hash := sha256.New()
	writer := io.MultiWriter(file, hash)
	if _, err := writer.Write(prefix); err != nil {
		return UploadedStorageObject{}, err
	}
	bytes, err := io.Copy(writer, io.LimitReader(input, MaxPersonalAssetBytes+1-int64(n)))
	if err != nil {
		return UploadedStorageObject{}, err
	}
	bytes += int64(n)
	if bytes > MaxPersonalAssetBytes {
		return UploadedStorageObject{}, safeMessageError{message: "单个文件不能超过 256 MB"}
	}
	if err := file.Sync(); err != nil {
		return UploadedStorageObject{}, err
	}
	if err := file.Close(); err != nil {
		return UploadedStorageObject{}, err
	}
	id := uuid.NewString()
	path := filepath.Join(config.Cfg.AssetFileDir, id)
	if err := os.Rename(file.Name(), path); err != nil {
		return UploadedStorageObject{}, err
	}
	object := model.StorageObject{
		ID: id, ProviderID: personalAssetFileProvider, ObjectKey: id, MimeType: mime,
		Bytes: bytes, SHA256: hex.EncodeToString(hash.Sum(nil)), CreatedBy: owner, CreatedAt: now(),
	}
	if _, err := repository.SaveStorageObject(object); err != nil {
		_ = os.Remove(path)
		return UploadedStorageObject{}, err
	}
	return UploadedStorageObject{ID: id, URL: "/api/files/" + id + "/content", StorageKey: "server:" + id, Bytes: bytes, MimeType: mime}, nil
}

// OpenPersonalAssetFile keeps the existing opaque media URL compatible with canvas nodes.
func OpenPersonalAssetFile(id string) (*os.File, string, error) {
	if _, err := uuid.Parse(id); err != nil || len(id) != 36 {
		return nil, "", nil
	}
	object, err := repository.GetStorageObject(id)
	if err != nil || object.ProviderID != personalAssetFileProvider {
		return nil, "", nil
	}
	if object.ObjectKey != id {
		return nil, "", errors.New("资产文件标识无效")
	}
	file, err := os.Open(filepath.Join(config.Cfg.AssetFileDir, id))
	return file, object.MimeType, err
}
