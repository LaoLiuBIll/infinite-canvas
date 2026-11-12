package repository

import (
	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
)

type PersonalAssetCategoryChanges struct {
	Save   []model.PersonalAssetCategory
	Remove string
	Assets []model.PersonalAsset
}

func ChangePersonalAssetCategories(userID string, change func([]model.PersonalAssetCategory, []model.PersonalAsset) (PersonalAssetCategoryChanges, error)) error {
	return personalAssetTransaction(userID, func(tx *gorm.DB) error {
		var categories []model.PersonalAssetCategory
		if err := tx.Where("user_id = ?", userID).Order("id").Find(&categories).Error; err != nil {
			return err
		}
		var assets []model.PersonalAsset
		if err := tx.Where("user_id = ?", userID).Order("updated_at DESC, id DESC").Find(&assets).Error; err != nil {
			return err
		}
		changes, err := change(categories, assets)
		if err != nil {
			return err
		}
		for _, category := range changes.Save {
			if err := tx.Save(&category).Error; err != nil {
				return err
			}
		}
		if changes.Remove != "" {
			if err := tx.Delete(&model.PersonalAssetCategory{}, "user_id = ? AND id = ?", userID, changes.Remove).Error; err != nil {
				return err
			}
		}
		for _, asset := range changes.Assets {
			if err := tx.Model(&model.PersonalAsset{}).Where("user_id = ? AND id = ?", userID, asset.ID).
				Updates(map[string]any{"data": asset.Data, "updated_at": asset.UpdatedAt}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
