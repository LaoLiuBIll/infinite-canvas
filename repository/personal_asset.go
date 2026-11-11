package repository

import (
	"github.com/tigerowo/infinite-canvas/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func ListPersonalAssets(userID string) ([]model.PersonalAsset, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var records []model.PersonalAsset
	err = db.Where("user_id = ?", userID).Order("updated_at DESC, id DESC").Find(&records).Error
	return records, err
}

func LegacyPersonalAssetData(userID string) (string, error) {
	db, err := DB()
	if err != nil {
		return "", err
	}
	var config model.UserConfig
	err = db.Select("asset_data").Where("user_id = ?", userID).Find(&config).Error
	return config.AssetData, err
}

func CreatePersonalAssets(records []model.PersonalAsset) error {
	if len(records) == 0 {
		return nil
	}
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(records, 16).Error
}

func EditPersonalAssets(userID string, ids []string, edit func(*model.PersonalAsset) error) ([]model.PersonalAsset, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var records []model.PersonalAsset
	err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND id IN ?", userID, ids).Order("id").Find(&records).Error; err != nil {
			return err
		}
		if len(records) != len(ids) {
			return gorm.ErrRecordNotFound
		}
		for i := range records {
			if err := edit(&records[i]); err != nil {
				return err
			}
			if err := tx.Save(&records[i]).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return records, err
}

func GetPersonalAsset(userID, id string) (model.PersonalAsset, error) {
	db, err := DB()
	if err != nil {
		return model.PersonalAsset{}, err
	}
	var asset model.PersonalAsset
	err = db.First(&asset, "user_id = ? AND id = ?", userID, id).Error
	return asset, err
}

func IsPersonalAssetFile(id string) (bool, error) {
	db, err := DB()
	if err != nil {
		return false, err
	}
	var count int64
	err = db.Model(&model.PersonalAsset{}).Where("storage_key = ?", "server:"+id).Limit(1).Count(&count).Error
	return count > 0, err
}
