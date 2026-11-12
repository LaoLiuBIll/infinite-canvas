package handler

import (
	"encoding/json"
	"net/http"

	"github.com/tigerowo/infinite-canvas/service"
)

func PersonalAssets(w http.ResponseWriter, r *http.Request) {
	data, err := service.CurrentPersonalAssets(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	OK(w, data)
}

func CreatePersonalAsset(w http.ResponseWriter, r *http.Request) {
	var asset json.RawMessage
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&asset) != nil {
		Fail(w, "资产内容无效或过大")
		return
	}
	data, err := service.CreatePersonalAsset(r.Context(), asset)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, data)
}

func EditPersonalAssets(w http.ResponseWriter, r *http.Request) {
	var request struct {
		IDs   []string                   `json:"ids"`
		Patch map[string]json.RawMessage `json:"patch"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&request) != nil {
		Fail(w, "资产修改内容无效或过大")
		return
	}
	data, err := service.UpdatePersonalAssets(r.Context(), request.IDs, request.Patch)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, data)
}

func PersonalAssetReferences(w http.ResponseWriter, r *http.Request) {
	data, err := service.PersonalAssetReferences(r.Context(), r.URL.Query().Get("id"))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, data)
}

func UploadPersonalAssetFile(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, service.MaxPersonalAssetBytes+(1<<20))
	file, header, err := r.FormFile("file")
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	if err != nil {
		Fail(w, "请选择文件，单个文件不能超过 256 MB")
		return
	}
	defer file.Close()
	data, err := service.SavePersonalAssetFile(r.Context(), file, header.Header.Get("Content-Type"))
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, data)
}

func PersonalAssetCatalog(w http.ResponseWriter, r *http.Request) {
	result, err := service.PersonalAssetCategories(r.Context())
	if err != nil {
		FailError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	OK(w, result)
}

func SavePersonalAssetCategory(w http.ResponseWriter, r *http.Request) {
	var request struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&request) != nil {
		Fail(w, "分类信息无效")
		return
	}
	result, err := service.SavePersonalAssetCategory(r.Context(), request.ID, request.Name)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

func DeletePersonalAssetCategory(w http.ResponseWriter, r *http.Request, id string) {
	result, err := service.DeletePersonalAssetCategory(r.Context(), id)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}
