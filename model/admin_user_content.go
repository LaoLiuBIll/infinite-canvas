package model

type AdminContentQuery struct {
	Query
	Section string
	UserID  string
	Role    UserRole
}

type AdminContentRecord struct {
	ID          string   `json:"id"`
	UserID      string   `json:"userId"`
	Username    string   `json:"username"`
	DisplayName string   `json:"displayName"`
	Role        UserRole `json:"role"`
	Source      string   `json:"source"`
	Title       string   `json:"title"`
	Kind        string   `json:"kind"`
	Status      string   `json:"status,omitempty"`
	Model       string   `json:"model,omitempty"`
	CreatedAt   string   `json:"createdAt"`
	Bytes       int64    `json:"bytes,omitempty"`
}

type AdminContentDetail struct {
	AdminContentRecord
	Text     string   `json:"text,omitempty"`
	Prompt   string   `json:"prompt,omitempty"`
	Category string   `json:"category,omitempty"`
	Folder   string   `json:"folder,omitempty"`
	SKU      string   `json:"sku,omitempty"`
	Tags     []string `json:"tags,omitempty"`
	Media    []string `json:"media,omitempty"`
}

type AdminContentList struct {
	Items []AdminContentRecord `json:"items"`
	Total int64                `json:"total"`
}
