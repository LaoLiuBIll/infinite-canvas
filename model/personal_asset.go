package model

// PersonalAsset is a private catalog entry. Its file may also be used by canvases.
type PersonalAsset struct {
	UserID     string `gorm:"size:64;primaryKey;index:idx_personal_assets_user_updated,priority:1"`
	ID         string `gorm:"size:128;primaryKey"`
	Data       string `gorm:"size:16777215;not null"`
	StorageKey string `gorm:"size:191;index"`
	UpdatedAt  string `gorm:"size:64;index:idx_personal_assets_user_updated,priority:2"`
}

// PersonalAssetCategory stores an account's categories, including empty ones.
type PersonalAssetCategory struct {
	UserID string `json:"-" gorm:"size:64;primaryKey"`
	ID     string `json:"id" gorm:"size:64;primaryKey"`
	Name   string `json:"name" gorm:"size:100;not null"`
}
