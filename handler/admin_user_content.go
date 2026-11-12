package handler

import (
	"io"
	"mime"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func AdminUserContent(w http.ResponseWriter, r *http.Request) {
	params := r.URL.Query()
	result, err := service.AdminUserContent(r.Context(), model.AdminContentQuery{
		Query: parseQuery(r), Section: params.Get("section"), UserID: params.Get("userId"), Role: model.UserRole(params.Get("role")),
	})
	if err != nil {
		FailError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	OK(w, result)
}

func AdminUserContentDetail(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	result, err := service.AdminUserContentDetail(r.Context(), q.Get("source"), q.Get("userId"), q.Get("id"))
	if err != nil {
		FailError(w, err)
		return
	}
	for i, value := range result.Media {
		if !isAdminExternalMedia(value) {
			continue
		}
		params := url.Values{"source": {q.Get("source")}, "userId": {q.Get("userId")}, "id": {q.Get("id")}, "index": {strconv.Itoa(i)}}
		result.Media[i] = "/api/admin/user-content/media?" + params.Encode()
	}
	w.Header().Set("Cache-Control", "no-store")
	OK(w, result)
}

func isAdminExternalMedia(value string) bool {
	return strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://")
}

const maxAdminPreviewBytes = 128 << 20

func AdminUserContentMedia(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	index, err := strconv.Atoi(q.Get("index"))
	if err != nil || index < 0 {
		FailWithStatus(w, http.StatusBadRequest, "预览编号无效")
		return
	}
	result, err := service.AdminUserContentDetail(r.Context(), q.Get("source"), q.Get("userId"), q.Get("id"))
	if err != nil || !slices.Contains([]string{"image", "video", "audio"}, result.Kind) || index >= len(result.Media) || !isAdminExternalMedia(result.Media[index]) {
		FailWithStatus(w, http.StatusNotFound, "找不到该外链媒体")
		return
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, result.Media[index], nil)
	if err != nil {
		FailWithStatus(w, http.StatusBadRequest, "媒体地址无效")
		return
	}
	response, err := service.SafeProxyHTTPClient().Do(request)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "外链媒体暂不可读取")
		return
	}
	defer response.Body.Close()
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if response.StatusCode != http.StatusOK || !strings.HasPrefix(mediaType, result.Kind+"/") || mediaType == "image/svg+xml" {
		FailWithStatus(w, http.StatusBadGateway, "外链已失效或返回了不支持的媒体格式")
		return
	}
	if response.ContentLength > maxAdminPreviewBytes {
		FailWithStatus(w, http.StatusRequestEntityTooLarge, "媒体过大，无法在线预览")
		return
	}
	w.Header().Set("Content-Type", mediaType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	_, _ = io.Copy(w, io.LimitReader(response.Body, maxAdminPreviewBytes+1))
}
