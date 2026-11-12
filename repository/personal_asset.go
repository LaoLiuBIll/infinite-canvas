package repository

import (
	"errors"
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

func ListPersonalAssetIDs(userID string) ([]string, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var ids []string
	err = db.Model(&model.PersonalAsset{}).Where("user_id = ?", userID).Pluck("id", &ids).Error
	return ids, err
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
	return personalAssetTransaction(records[0].UserID, func(tx *gorm.DB) error {
		return tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(records, 16).Error
	})
}

var ErrPersonalAssetCategoryNotFound = errors.New("personal asset category not found")

func personalAssetTransaction(userID string, change func(*gorm.DB) error) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Select("id").Clauses(clause.Locking{Strength: "UPDATE"}).Take(&user, "id = ?", userID).Error; err != nil {
			return err
		}
		return change(tx)
	})
}

func selectedPersonalAssetCategory(tx *gorm.DB, userID string, id *string) (*string, error) {
	if id == nil {
		return nil, nil
	}
	if *id == "" {
		empty := ""
		return &empty, nil
	}
	var category model.PersonalAssetCategory
	err := tx.Take(&category, "user_id = ? AND id = ?", userID, *id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrPersonalAssetCategoryNotFound
	}
	return &category.Name, err
}

func CreateManagedPersonalAsset(record model.PersonalAsset, categoryID *string, prepare func(*model.PersonalAsset, *string) error) (model.PersonalAsset, error) {
	err := personalAssetTransaction(record.UserID, func(tx *gorm.DB) error {
		var existing model.PersonalAsset
		err := tx.Take(&existing, "user_id = ? AND id = ?", record.UserID, record.ID).Error
		if err == nil {
			record = existing
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		name, err := selectedPersonalAssetCategory(tx, record.UserID, categoryID)
		if err != nil {
			return err
		}
		if err := prepare(&record, name); err != nil {
			return err
		}
		return tx.Create(&record).Error
	})
	return record, err
}

func EditPersonalAssets(userID string, ids []string, categoryID *string, edit func(*model.PersonalAsset, *string) error) ([]model.PersonalAsset, error) {
	var records []model.PersonalAsset
	err := personalAssetTransaction(userID, func(tx *gorm.DB) error {
		name, err := selectedPersonalAssetCategory(tx, userID, categoryID)
		if err != nil {
			return err
		}
		if err := tx.Where("user_id = ? AND id IN ?", userID, ids).Order("id").Find(&records).Error; err != nil {
			return err
		}
		if len(records) != len(ids) {
			return gorm.ErrRecordNotFound
		}
		for i := range records {
			if err := edit(&records[i], name); err != nil {
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
