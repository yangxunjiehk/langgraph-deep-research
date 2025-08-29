-- 研究报告数据库表结构
CREATE TABLE IF NOT EXISTS research_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    query TEXT NOT NULL,          -- 用户的原始查询
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'completed',  -- completed, draft, failed
    word_count INTEGER DEFAULT 0,
    research_time INTEGER DEFAULT 0, -- 研究耗时（秒）
    metadata TEXT                   -- JSON格式的额外元数据
);

-- 创建索引加快查询
CREATE INDEX IF NOT EXISTS idx_created_at ON research_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_status ON research_reports(status);
CREATE INDEX IF NOT EXISTS idx_title ON research_reports(title);